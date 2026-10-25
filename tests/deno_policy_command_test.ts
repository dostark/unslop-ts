/**
 * @module DenoPolicyCommandTest
 * @path tests/deno_policy_command_test.ts
 * @description Builds an offline Deno lint policy directory from a version 2 configuration and checks its files, atomicity, and CLI route.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/cli/commands/deno_policy.ts, src/cli/unslop.ts, examples/unslop.config.json]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { buildDenoPolicy, DenoPolicyError, type IEngineBundler } from "../src/cli/commands/deno_policy.ts";
import { main } from "../src/cli/unslop.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const EXAMPLE_CONFIG = join(ROOT, "examples/unslop.config.json");
const SEED = "export const s = 1 as unknown as string;\n";
const POLICY_FILES = ["catalog.json", "deno.json", "manifest.json", "plugin.ts", "unslop_engine.js"];
const FAKE_ENGINE = "export {};\n";

/** Writes a placeholder engine so tests that do not lint skip the slow real bundle. */
const fakeBundler: IEngineBundler = {
  async bundle(outFile: string): Promise<void> {
    await Deno.writeTextFile(outFile, FAKE_ENGINE);
  },
};

async function listNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names.sort();
}

async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function lintCodes(policyDir: string, source: string): Promise<string[]> {
  const work = await Deno.makeTempDir({ prefix: "deno-policy-seed-" });
  try {
    const seed = join(work, "seed.ts");
    await Deno.writeTextFile(seed, source);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["lint", "--deny-import", "--config", join(policyDir, "deno.json"), "--rules-tags=", "--json", seed],
      cwd: work,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const report = JSON.parse(new TextDecoder().decode(result.stdout)) as {
      diagnostics: { code: string | null }[];
    };
    return report.diagnostics.map((diagnostic) => diagnostic.code ?? "");
  } finally {
    await Deno.remove(work, { recursive: true });
  }
}

Deno.test("deno-policy-command-offline: the built directory lints with the real engine and no remote import", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    await buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out: join(out, "policy") });
    assertEquals(await listNames(join(out, "policy")), POLICY_FILES);
    const codes = await lintCodes(join(out, "policy"), SEED);
    assert(codes.includes("demo/no-chained-type-assertions"), codes.join(","));
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("deno-policy-atomic-and-manifest: five files with matching checksums and engine identity", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    const target = join(out, "policy");
    const report = await buildDenoPolicy({
      config: EXAMPLE_CONFIG,
      packs: ["typescript", "deno"],
      out: target,
      bundler: fakeBundler,
    });
    assertEquals(await listNames(target), POLICY_FILES);
    assertEquals(report.out, target);
    const manifest = JSON.parse(await Deno.readTextFile(join(target, "manifest.json")));
    assertEquals(manifest.format_version, 1);
    assertEquals(manifest.plugin, "demo");
    assertEquals(manifest.packs, ["typescript", "deno"]);
    assertEquals(manifest.deno_version, Deno.version.deno);
    assertEquals(typeof manifest.engine.package_version, "string");
    assertEquals(Object.keys(manifest.files).sort(), POLICY_FILES.filter((name) => name !== "manifest.json"));
    for (const [name, entry] of Object.entries(manifest.files as Record<string, { sha256: string; bytes: number }>)) {
      assertEquals(entry.sha256, await sha256(join(target, name)), name);
      assertEquals(entry.bytes, (await Deno.stat(join(target, name))).size, name);
    }
    const plugin = await Deno.readTextFile(join(target, "plugin.ts"));
    assertStringIncludes(plugin, "DENO_RULE_PACK");
    assertStringIncludes(plugin, 'from "./unslop_engine.js"');
    const catalog = JSON.parse(await Deno.readTextFile(join(target, "catalog.json")));
    assert("demo/no-forbidden-lint-ignore" in catalog.rules, "the deno pack rules are in the catalog");
    assertEquals(JSON.parse(await Deno.readTextFile(join(target, "deno.json"))), {
      lock: false,
      lint: { plugins: ["./plugin.ts"] },
    });
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("deno-policy-atomic-and-manifest: a failed build leaves an existing directory untouched", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    const target = join(out, "policy");
    await buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out: target, bundler: fakeBundler });
    await Deno.writeTextFile(join(target, "sentinel.txt"), "keep");
    const badConfig = join(out, "bad.json");
    await Deno.writeTextFile(badConfig, JSON.stringify({ version: 2, plugin: "demo", rules: { "demo/nope": {} } }));
    await assertRejects(
      () => buildDenoPolicy({ config: badConfig, packs: ["typescript"], out: target, bundler: fakeBundler }),
      DenoPolicyError,
    );
    const failing: IEngineBundler = {
      bundle(): Promise<void> {
        return Promise.reject(new Error("bundle exploded"));
      },
    };
    await assertRejects(
      () => buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out: target, bundler: failing }),
      DenoPolicyError,
      "bundle exploded",
    );
    assertEquals(await listNames(target), [...POLICY_FILES, "sentinel.txt"].sort());
    assertEquals(await Deno.readTextFile(join(target, "sentinel.txt")), "keep");
    assertEquals(await Deno.readTextFile(join(target, "unslop_engine.js")), FAKE_ENGINE);
    assertEquals((await listNames(out)).filter((name) => name.includes("tmp")), []);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("deno-policy-atomic-and-manifest: a rebuild replaces a previous policy build completely", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    const target = join(out, "policy");
    await buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out: target, bundler: fakeBundler });
    await Deno.writeTextFile(join(target, "stale.txt"), "old");
    await buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript", "deno"], out: target, bundler: fakeBundler });
    assertEquals(await listNames(target), POLICY_FILES);
    assertStringIncludes(await Deno.readTextFile(join(target, "plugin.ts")), "DENO_RULE_PACK");
    const empty = join(out, "empty");
    await Deno.mkdir(empty);
    await buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out: empty, bundler: fakeBundler });
    assertEquals(await listNames(empty), POLICY_FILES);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("deno-policy-atomic-and-manifest: a populated directory that is not a policy build is refused", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    await Deno.writeTextFile(join(out, "precious.txt"), "keep");
    await assertRejects(
      () => buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out, bundler: fakeBundler }),
      DenoPolicyError,
      "not a policy directory",
    );
    assertEquals(await listNames(out), ["precious.txt"]);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("deno-policy-atomic-and-manifest: packs and the output root are validated", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    for (const packs of [[], ["python"], ["typescript", "typescript"], ["deno"]] as const) {
      await assertRejects(
        () => buildDenoPolicy({ config: EXAMPLE_CONFIG, packs, out: join(out, "p"), bundler: fakeBundler }),
        DenoPolicyError,
      );
    }
    await assertRejects(
      () => buildDenoPolicy({ config: EXAMPLE_CONFIG, packs: ["typescript"], out: ROOT, bundler: fakeBundler }),
      DenoPolicyError,
    );
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("deno-policy-command-offline: the CLI route writes the directory and reports usage errors with exit 2", async () => {
  const out = await Deno.makeTempDir({ prefix: "deno-policy-out-" });
  try {
    const target = join(out, "policy");
    assertEquals(await main(["deno-policy", `--config=${EXAMPLE_CONFIG}`, "--packs=typescript", `--out=${target}`]), 0);
    assertEquals(await listNames(target), POLICY_FILES);
    assertEquals(await main(["deno-policy", `--config=${EXAMPLE_CONFIG}`]), 2);
    assertEquals(await main(["deno-policy", `--out=${target}`]), 2);
    assertEquals(await main(["deno-policy", `--config=${EXAMPLE_CONFIG}`, "--packs=python", `--out=${target}`]), 2);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

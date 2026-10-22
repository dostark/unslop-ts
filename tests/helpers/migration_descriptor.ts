/**
 * @module MigrationDescriptorTestHelper
 * @path tests/helpers/migration_descriptor.ts
 * @description The descriptor a neutral version 1 migration fixture compiles against: the TypeScript pack, one consumer script, and duplicate hosts.
 * @architectural-layer Test
 * @dependencies [zod]
 * @related-files [tests/cases/catalog_v1_example.json, src/config/migrate.ts]
 */

import { z } from "zod";
import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK, WHOLE_TREE_CHECKS } from "../../mod.ts";

const ROOT_URL = new URL("file:///project/");

/** A consumer script rule with one defaulted option, so migration must preserve an explicit value. */
export const PROJECT_CHECK_SCHEMA = z.object({
  threshold: z.number().int().positive().default(1),
}).strict();

function duplicateControls(scope: "prod" | "all", include: readonly string[] | null) {
  return {
    editable: ["options"] as const,
    fixedLevel: "error" as const,
    fixedScope: scope,
    fixedInclude: include,
    fixedExclude: null,
    hostModes: { default: "error" as const },
  };
}

/** The descriptor of the neutral migration project. */
export function migrationDescriptor(): IProjectDescriptor {
  return {
    pluginName: "demo",
    rootUrl: ROOT_URL,
    configUrl: new URL("unslop.config.json", ROOT_URL),
    lintConfigUrl: new URL("deno.json", ROOT_URL),
    pluginUrl: new URL("lint_plugin.ts", ROOT_URL),
    packs: [TYPESCRIPT_RULE_PACK],
    scriptRules: {
      "project-check": {
        meta: {
          description: "A consumer script check.",
          category: "scripts",
          docs: "#consumer-guide",
          preset: "opt-in",
          limits: "A consumer limit.",
        },
        optionSchema: PROJECT_CHECK_SCHEMA,
        controls: {
          editable: ["level", "options"],
          fixedLevel: null,
          fixedScope: null,
          fixedInclude: null,
          fixedExclude: null,
          hostModes: { default: "warn" },
        },
        command: ["deno", "task", "check:project"],
      },
    },
    wholeTreeHosts: {
      "duplicate-type": {
        controls: duplicateControls("prod", ["src/**"]),
        command: ["deno", "task", "check:duplicates"],
      },
      "duplicate-constant": {
        controls: duplicateControls("all", null),
        command: ["deno", "task", "check:duplicates"],
      },
    },
  };
}

/** The check metadata that a fixture limit must match. */
export function checkLimit(id: keyof typeof WHOLE_TREE_CHECKS): string | null {
  return WHOLE_TREE_CHECKS[id].meta.limits;
}

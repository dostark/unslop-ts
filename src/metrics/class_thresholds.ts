/**
 * @module ClassThresholds
 * @path src/metrics/class_thresholds.ts
 * @description The default class detection thresholds with their sources. Each value is second-hand, because the printed book of Lanza and Marinescu was not available.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/rule_options.ts, src/rules/max_class_size.ts, tests/class_thresholds_test.ts]
 */

/** One default threshold, the sources that quote it and the date that those sources were read. */
export interface IClassThreshold {
  readonly value: number;
  readonly sources: readonly string[];
  /** The ISO date on which the sources were retrieved. */
  readonly retrieved: string;
  readonly label: "second-hand";
}

/** The label of a value that a secondary source quotes from the book. */
export const SECOND_HAND_LABEL = "second-hand";

const SOURCES_RETRIEVED = "2026-11-04";
/** A source code listing of a God Class detector that quotes the three values and cites the book. */
const GOD_CLASS_IMPLEMENTATION = "https://docs.rs/cha-core/1.20.0/src/cha_core/plugins/god_class.rs.html";
/** Lecture slides that state the strategy and cite section 5.3 of the book. */
const GOD_CLASS_SLIDES = "https://homepages.dcc.ufmg.br/~figueiredo/disciplinas/lectures/bad-smell-detection_v01.pdf";

/** An article on the Data Class strategy that gives Few, Many, one third and the WMC levels for the NDepend query. */
const DATA_CLASS_ARTICLE = "https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/";
/** An article on the Feature Envy strategy that gives Few and one third for ATFD, LAA and FDP. */
const FEATURE_ENVY_ARTICLE = "https://simpleorientedarchitecture.com/how-to-identify-feature-envy-using-ndepend/";

/** Builds a second-hand threshold from the sources that were read on one date. */
function secondHand(value: number, sources: readonly string[]): IClassThreshold {
  return { value, sources, retrieved: SOURCES_RETRIEVED, label: SECOND_HAND_LABEL };
}

/** The name of one recorded default threshold. */
export type ClassThresholdName =
  | "wmcVeryHigh"
  | "tccLimit"
  | "atfdFew"
  | "wmcHigh"
  | "dataClassFew"
  | "dataClassMany"
  | "wocLimit"
  | "laaLimit"
  | "fdpFew";

/** The defaults of the God Class, Data Class and Feature Envy strategies of Lanza and Marinescu. */
export const CLASS_THRESHOLDS: Readonly<Record<ClassThresholdName, IClassThreshold>> = {
  wmcVeryHigh: secondHand(47, [GOD_CLASS_IMPLEMENTATION, GOD_CLASS_SLIDES, DATA_CLASS_ARTICLE]),
  tccLimit: secondHand(1 / 3, [GOD_CLASS_IMPLEMENTATION, GOD_CLASS_SLIDES]),
  atfdFew: secondHand(5, [GOD_CLASS_IMPLEMENTATION, GOD_CLASS_SLIDES, FEATURE_ENVY_ARTICLE]),
  wmcHigh: secondHand(31, [DATA_CLASS_ARTICLE]),
  dataClassFew: secondHand(5, [DATA_CLASS_ARTICLE]),
  dataClassMany: secondHand(8, [DATA_CLASS_ARTICLE]),
  wocLimit: secondHand(1 / 3, [DATA_CLASS_ARTICLE]),
  laaLimit: secondHand(1 / 3, [FEATURE_ENVY_ARTICLE, GOD_CLASS_SLIDES]),
  fdpFew: secondHand(5, [FEATURE_ENVY_ARTICLE, GOD_CLASS_SLIDES]),
};

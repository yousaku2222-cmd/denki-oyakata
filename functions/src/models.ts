// One constant per job. Change models here only.
export const MODEL_ROUTER = "claude-haiku-5-5"; // classify / rephrase the question
export const MODEL_SUMMARY = "claude-haiku-5-5"; // the conclusion line on top of an answer, from the checked sentences
export const MODEL_FAITHFUL = "claude-sonnet-5-5"; // whether each sentence of a card draft was really said by the veteran
export const MODEL_ANSWER = "claude-sonnet-5-5"; // answers, calc tool picking, interviews, card drafts, photos
export const MODEL_HEAVY = "claude-opus-5-5"; // law cards (one-off), reviewer

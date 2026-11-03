import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import { anthropicKey, getClient } from "./claude";
import { callerIp, takeQuota } from "./limits";
import { interviewNext as interviewNextImpl, draftCard as draftCardImpl, publishCard as publishCardImpl, setCardStatus as setCardStatusImpl, myCards as myCardsImpl, myCard as myCardImpl, deleteDraft as deleteDraftImpl } from "./interview";
import { ask as askImpl, markHelped as markHelpedImpl } from "./ask";
import { sendToBox as sendToBoxImpl, markGoodQuestion as markGoodQuestionImpl, openQuestions as openQuestionsImpl, questionPhoto as questionPhotoImpl, myQuestions as myQuestionsImpl } from "./box";
import { identifyPart as identifyPartImpl } from "./photo";
import { makeTransferCode as makeTransferCodeImpl, useTransferCode as useTransferCodeImpl } from "./transfer";
import { listLaws as listLawsImpl, getLaw as getLawImpl } from "./laws";
import { listCalcs as listCalcsImpl, runCalc } from "./calc";
import { CalcInputError } from "./calc/types";

setGlobalOptions({ region: "asia-northeast1", maxInstances: 5 });

export interface Ctx {
  ip: string; // the caller's network address, for the per-address daily caps
  charge: () => Promise<void>; // counts one Claude-backed answer (for functions that count themselves: ask)
  chargeCached: () => Promise<void>; // counts one saved answer, against its own looser cap
}
type Handler = (data: Record<string, unknown>, uid: string, ctx: Ctx) => Promise<unknown>;


// How a function is counted: "claude" before it runs, "photo" as two answers plus the photo cap,
// "self" when the function calls ctx.charge() itself (ask: a saved answer counts only against the looser "cached" cap).
type Quota = false | "claude" | "photo" | "self";

// Every call needs a signed-in user (anonymous sign-in, invisible to the user).
// The uid comes from the verified token, never from the request body.
function callable(fn: Handler, quota: Quota = false) {
  const useClaude = quota !== false;
  return onCall({ secrets: useClaude ? [anthropicKey] : [], timeoutSeconds: 120 }, async (req: CallableRequest) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "もう一度アプリを開き直してください。");
    try {
      const ip = callerIp(req.rawRequest?.headers?.["x-forwarded-for"], req.rawRequest?.ip);
      const charge = async () => {
        if (getClient()) await takeQuota(uid, "claude", ip);
      };
      const chargeCached = async () => {
        if (getClient()) await takeQuota(uid, "cached", ip);
      };
      const ctx: Ctx = { ip, charge, chargeCached };
      if (quota === "photo" && getClient()) {
        await takeQuota(uid, "photo", ip);
        await charge();
        await charge();
      } else if (quota === "claude") await charge();
      return await fn((req.data ?? {}) as Record<string, unknown>, uid, ctx);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error(e);
      throw new HttpsError("internal", "処理に失敗しました。もう一度お試しください。");
    }
  });
}

export const interviewNext = callable(interviewNextImpl, "claude");
export const draftCard = callable(draftCardImpl, "claude");
export const publishCard = callable(publishCardImpl);
export const setCardStatus = callable(setCardStatusImpl);
export const myCards = callable(myCardsImpl);
export const myCard = callable(myCardImpl);
export const deleteDraft = callable(deleteDraftImpl);
export const ask = callable(askImpl, "self");
export const markHelped = callable(markHelpedImpl);
export const sendToBox = callable(sendToBoxImpl);
export const markGoodQuestion = callable(markGoodQuestionImpl);
export const openQuestions = callable(openQuestionsImpl);
export const questionPhoto = callable(questionPhotoImpl);
export const myQuestions = callable(myQuestionsImpl);
export const identifyPart = callable(identifyPartImpl, "photo");
export const makeTransferCode = callable(makeTransferCodeImpl);
export const useTransferCode = callable(useTransferCodeImpl);
export const listLaws = callable(listLawsImpl);
export const getLaw = callable(getLawImpl);
export const listCalcs = callable(listCalcsImpl);
export const calc = callable(async (data) => {
  try {
    return { result: runCalc(String(data.name ?? ""), (data.params ?? {}) as Record<string, unknown>) };
  } catch (e) {
    if (e instanceof CalcInputError) throw new HttpsError("invalid-argument", e.message);
    throw e;
  }
});

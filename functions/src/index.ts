import { onCall, HttpsError, CallableRequest, CallableOptions } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import { anthropicKey, getClient, isBusy } from "./claude";
import { QuotaKind, callerIp, giveBackQuota, takeQuota } from "./limits";
import { interviewNext as interviewNextImpl, draftCard as draftCardImpl, publishCard as publishCardImpl, setCardStatus as setCardStatusImpl, myCards as myCardsImpl, myCard as myCardImpl, deleteDraft as deleteDraftImpl } from "./interview";
import { ask as askImpl, markHelped as markHelpedImpl } from "./ask";
import { sendToBox as sendToBoxImpl, markGoodQuestion as markGoodQuestionImpl, openQuestions as openQuestionsImpl, questionPhoto as questionPhotoImpl, myQuestions as myQuestionsImpl, talkSeeds as talkSeedsImpl, withdrawQuestion as withdrawQuestionImpl } from "./box";
import { identifyPart as identifyPartImpl } from "./photo";
import { makeTransferCode as makeTransferCodeImpl, useTransferCode as useTransferCodeImpl } from "./transfer";
import { listLaws as listLawsImpl, getLaw as getLawImpl, listGlossary as listGlossaryImpl } from "./laws";
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

const BUSY_MSG = "いま混み合っています。少し待ってから、もう一度お試しください。";

// Every call needs a signed-in user (anonymous sign-in, invisible to the user).
// The uid comes from the verified token, never from the request body.
function callable(fn: Handler, quota: Quota = false, opts: CallableOptions = {}) {
  const useClaude = quota !== false;
  return onCall({ secrets: useClaude ? [anthropicKey] : [], timeoutSeconds: 120, ...opts }, async (req: CallableRequest) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "もう一度アプリを開き直してください。");
    const ip = callerIp(req.rawRequest?.headers?.["x-forwarded-for"], req.rawRequest?.ip);
    const taken: QuotaKind[] = []; // what this call has counted, to give back if Claude was busy
    const take = async (kind: QuotaKind) => {
      await takeQuota(uid, kind, ip);
      taken.push(kind);
    };
    try {
      const charge = async () => {
        if (getClient()) await take("claude");
      };
      const chargeCached = async () => {
        if (getClient()) await take("cached");
      };
      const ctx: Ctx = { ip, charge, chargeCached };
      if (quota === "photo" && getClient()) {
        await take("photo");
        await charge();
        await charge();
      } else if (quota === "claude") await charge();
      return await fn((req.data ?? {}) as Record<string, unknown>, uid, ctx);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      if (isBusy(e)) {
        // Claude's rate limit or overload: not the user's doing, so the counts go back
        logger.warn("claude busy", (e as { status?: number }).status);
        await Promise.all(taken.map((k) => giveBackQuota(uid, k, ip).catch((err) => logger.error("give back failed", err))));
        throw new HttpsError("unavailable", BUSY_MSG);
      }
      logger.error(e);
      throw new HttpsError("internal", "処理に失敗しました。もう一度お試しください。");
    }
  });
}

// One warm instance each for the judging days, so the first question or interview does not wait for a cold start.
// TODO: set back to 0 (remove KEEP_WARM) once the judging period ends on 11/10. It is billed while idle.
const KEEP_WARM: CallableOptions = { minInstances: 1 };

export const interviewNext = callable(interviewNextImpl, "claude", KEEP_WARM);
export const draftCard = callable(draftCardImpl, "claude", KEEP_WARM);
export const publishCard = callable(publishCardImpl, false, KEEP_WARM);
export const setCardStatus = callable(setCardStatusImpl);
export const myCards = callable(myCardsImpl);
export const myCard = callable(myCardImpl);
export const deleteDraft = callable(deleteDraftImpl);
export const ask = callable(askImpl, "self", KEEP_WARM);
export const markHelped = callable(markHelpedImpl);
export const sendToBox = callable(sendToBoxImpl);
export const markGoodQuestion = callable(markGoodQuestionImpl);
export const openQuestions = callable(openQuestionsImpl);
export const talkSeeds = callable(talkSeedsImpl);
export const questionPhoto = callable(questionPhotoImpl);
export const myQuestions = callable(myQuestionsImpl);
export const withdrawQuestion = callable(withdrawQuestionImpl);
// sharp decodes photos of up to 40M pixels: more memory, and fewer photos at once on one instance
export const identifyPart = callable(identifyPartImpl, "photo", { memory: "1GiB", concurrency: 4 });
export const makeTransferCode = callable(makeTransferCodeImpl);
export const useTransferCode = callable(useTransferCodeImpl);
export const listLaws = callable(listLawsImpl);
export const getLaw = callable(getLawImpl);
export const listGlossary = callable(listGlossaryImpl);
export const listCalcs = callable(listCalcsImpl);
export const calc = callable(async (data) => {
  try {
    return { result: runCalc(String(data.name ?? ""), (data.params ?? {}) as Record<string, unknown>) };
  } catch (e) {
    if (e instanceof CalcInputError) throw new HttpsError("invalid-argument", e.message);
    throw e;
  }
});

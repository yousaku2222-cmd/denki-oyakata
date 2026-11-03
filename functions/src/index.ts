import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import { anthropicKey, getClient } from "./claude";
import { ipKey, takeQuota, takeWriteQuota } from "./limits";
import { interviewNext as interviewNextImpl, draftCard as draftCardImpl, publishCard as publishCardImpl, setCardStatus as setCardStatusImpl, myCards as myCardsImpl } from "./interview";
import { ask as askImpl, markHelped as markHelpedImpl } from "./ask";
import { sendToBox as sendToBoxImpl, markGoodQuestion as markGoodQuestionImpl } from "./box";
import { identifyPart as identifyPartImpl } from "./photo";
import { listLaws as listLawsImpl, getLaw as getLawImpl } from "./laws";
import { listCalcs as listCalcsImpl, runCalc } from "./calc";
import { CalcInputError } from "./calc/types";

setGlobalOptions({ region: "asia-northeast1", maxInstances: 5 });

/** charge() counts one Claude-backed call against the daily caps (a no-op without an API key). */
export type Handler = (data: Record<string, unknown>, uid: string, charge: () => Promise<void>) => Promise<unknown>;

// How a function is counted: "claude" before it runs, "photo" as two answers plus the photo cap,
// "self" when the function calls charge() itself (ask: a saved answer costs nothing), "write" for shared writes.
type Quota = "none" | "claude" | "photo" | "self" | "write";

// Every call needs a signed-in user (anonymous sign-in, invisible to the user).
// The uid comes from the verified token, never from the request body.
function callable(fn: Handler, quota: Quota = "none") {
  const useClaude = quota === "claude" || quota === "photo" || quota === "self";
  return onCall({ secrets: useClaude ? [anthropicKey] : [], timeoutSeconds: 120 }, async (req: CallableRequest) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "もう一度アプリを開き直してください。");
    const ip = ipKey(req.rawRequest?.headers?.["x-forwarded-for"], req.rawRequest?.ip);
    const charge = async () => {
      if (getClient()) await takeQuota(uid, ip, quota === "photo" ? { weight: 2, photo: true } : {});
    };
    try {
      if (quota === "claude" || quota === "photo") await charge();
      if (quota === "write") await takeWriteQuota(uid, ip);
      return await fn((req.data ?? {}) as Record<string, unknown>, uid, charge);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error(e);
      throw new HttpsError("internal", "処理に失敗しました。もう一度お試しください。");
    }
  });
}

export const interviewNext = callable(interviewNextImpl, "claude");
export const draftCard = callable(draftCardImpl, "claude");
export const publishCard = callable(publishCardImpl, "write");
export const setCardStatus = callable(setCardStatusImpl);
export const myCards = callable(myCardsImpl);
export const ask = callable(askImpl, "self");
export const markHelped = callable(markHelpedImpl);
export const sendToBox = callable(sendToBoxImpl, "write");
export const markGoodQuestion = callable(markGoodQuestionImpl);
export const identifyPart = callable(identifyPartImpl, "photo");
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

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import { anthropicKey } from "./claude";
import { interviewNext as interviewNextImpl, draftCard as draftCardImpl, publishCard as publishCardImpl, setCardStatus as setCardStatusImpl, myCards as myCardsImpl } from "./interview";
import { ask as askImpl, markHelped as markHelpedImpl } from "./ask";
import { sendToBox as sendToBoxImpl, markGoodQuestion as markGoodQuestionImpl } from "./box";

setGlobalOptions({ region: "asia-northeast1", maxInstances: 5 });

type Handler = (data: Record<string, unknown>) => Promise<unknown>;

function callable(fn: Handler, useClaude = false) {
  return onCall({ secrets: useClaude ? [anthropicKey] : [], timeoutSeconds: 120 }, async (req: CallableRequest) => {
    try {
      return await fn((req.data ?? {}) as Record<string, unknown>);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error(e);
      throw new HttpsError("internal", "処理に失敗しました。もう一度お試しください。");
    }
  });
}

export const interviewNext = callable(interviewNextImpl, true);
export const draftCard = callable(draftCardImpl, true);
export const publishCard = callable(publishCardImpl);
export const setCardStatus = callable(setCardStatusImpl);
export const myCards = callable(myCardsImpl);
export const ask = callable(askImpl, true);
export const markHelped = callable(markHelpedImpl);
export const sendToBox = callable(sendToBoxImpl);
export const markGoodQuestion = callable(markGoodQuestionImpl);

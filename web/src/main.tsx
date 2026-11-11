import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import App from "./App.tsx";
import { ConfirmHost } from "./Confirm";
import { signedIn } from "./firebase";

const root = createRoot(document.getElementById("root")!);

signedIn
  .then(() =>
    root.render(
      <StrictMode>
        {/* devices set to reduce motion get the end state without the movement */}
        <MotionConfig reducedMotion="user">
          <App />
          <ConfirmHost />
        </MotionConfig>
      </StrictMode>,
    ),
  )
  .catch(() =>
    root.render(<p style={{ padding: 24 }}>接続できませんでした。電波の良い所で、ページを開き直してください。</p>),
  );

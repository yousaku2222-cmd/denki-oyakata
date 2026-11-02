import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { signedIn } from "./firebase";

const root = createRoot(document.getElementById("root")!);

signedIn
  .then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch(() =>
    root.render(<p style={{ padding: 24 }}>接続できませんでした。電波の良い所で、ページを開き直してください。</p>),
  );

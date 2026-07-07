import { createRoot } from "react-dom/client";

import App from "./App";
import { initI18n } from "./utils/i18nUtils";

// Ensure that locales are loaded before rendering the app
initI18n().then(() => {
  createRoot(document.getElementById("app")).render(<App />);
});

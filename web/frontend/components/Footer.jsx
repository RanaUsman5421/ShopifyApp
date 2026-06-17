import { NavLink } from "react-router-dom";
import "../App.css";

export default function Footer() {
  return (
    <footer className="w-full lionex-footer py-space-4 bg-surface-container-low border-t border-outline-variant flex flex-row items-center justify-between px-space-8">
      <a className="font-label-sm text-label-sm text-on-tertiary-fixed-variant">
        © 2026 LionEx Private LTD.
      </a>
      <div className="flex lionex-footer gap-space-6">
        <a
          href="#"
          className="font-label-sm text-label-sm text-on-tertiary-fixed-variant hover:text-primary underline transition-colors"
        >
          Terms of Service
        </a>
        <NavLink to="/privacypolicy"
          href="#"
          className="font-label-sm text-label-sm text-on-tertiary-fixed-variant hover:text-primary underline transition-colors"
        >
          Privacy Policy
        </NavLink>
      </div>
    </footer>
  );
}

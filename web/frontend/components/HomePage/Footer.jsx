export default function Footer() {
  return (
    <footer className="w-full py-space-4 bg-surface-container-low border-t border-outline-variant">
      <div className="flex justify-between items-center px-space-8 max-w-7xl mx-auto w-full ml-64">
        <p className="font-label-sm text-label-sm text-on-tertiary-fixed-variant">
          © 2024 LionEx Logistics. All rights reserved.
        </p>
        <div className="flex gap-space-6">
          <a
            href="#"
            className="font-label-sm text-label-sm text-on-tertiary-fixed-variant hover:text-primary underline transition-colors"
          >
            Terms of Service
          </a>
          <a
            href="#"
            className="font-label-sm text-label-sm text-on-tertiary-fixed-variant hover:text-primary underline transition-colors"
          >
            Privacy Policy
          </a>
        </div>
      </div>
    </footer>
  );
}

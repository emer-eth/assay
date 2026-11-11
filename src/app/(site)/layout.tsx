// Public pages (home, rules): no wallet provider and no live store, so they ship no wallet code once
// their own header replaces the shared one (build spec, step 7).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

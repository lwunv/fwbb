export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <h1 className="text-2xl font-bold">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: March 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What we collect</h2>
        <p>When you sign in with Facebook, we receive your public profile (name, profile picture) and email address. This is used solely to identify you within the app.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How we use your data</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Display your name and avatar in the app</li>
          <li>Track your session attendance, votes, and payments</li>
          <li>Send group notifications via Messenger (if configured)</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Data sharing</h2>
        <p>We do not sell or share your data with third parties. Your data is stored securely and only accessible to app administrators.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Data deletion</h2>
        <p>Contact the app administrator to request deletion of your account and associated data.</p>
      </section>
    </div>
  );
}

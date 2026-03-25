export default function DataDeletionPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <h1 className="text-2xl font-bold">Data Deletion Instructions</h1>

      <section className="space-y-3">
        <p>
          If you want to delete your data from FWBB, you can request deletion by
          contacting the app administrator.
        </p>

        <h2 className="text-lg font-semibold">How to request data deletion</h2>
        <ol className="list-decimal pl-6 space-y-2">
          <li>Contact the admin of your FWBB group</li>
          <li>Request to have your account deactivated and data removed</li>
          <li>The admin will delete your member record and all associated data (votes, attendance, debts)</li>
        </ol>

        <h2 className="text-lg font-semibold">What data will be deleted</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Your member profile (name, Facebook ID, avatar, email)</li>
          <li>Your session votes</li>
          <li>Your attendance records</li>
          <li>Your debt/payment records</li>
        </ul>

        <p className="text-sm text-muted-foreground">
          Data deletion is typically completed within 7 days of the request.
        </p>
      </section>
    </div>
  );
}

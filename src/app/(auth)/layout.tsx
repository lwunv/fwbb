export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="from-background to-muted/40 flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-4">
      <div className="bg-card/80 w-full max-w-sm space-y-4 rounded-2xl border p-6 shadow-sm backdrop-blur">
        {children}
      </div>
    </div>
  );
}

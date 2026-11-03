import { MemberShell } from "@/components/layout/member-shell";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MemberShell mode="group">{children}</MemberShell>;
}

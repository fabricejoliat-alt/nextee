import "./admin.css";
import AdminHeader from "./AdminHeader";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-page">
      <AdminHeader />
      <div className="admin-scroll-area">
        <main className="app-shell admin-shell">{children}</main>
      </div>
    </div>
  );
}

import "./admin.css";
import AdminTopbar from "./AdminTopbar";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="adminShell">
      <div className="main">
        <AdminTopbar />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

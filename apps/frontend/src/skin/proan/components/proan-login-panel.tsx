import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import { proanBranding } from "@/skin/proan/branding";
import proanLogo from "@/skin/proan/assets/logos/logoproan.png";

export function ProanLoginPanel() {
  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-brand-mark">
          <Image
            alt={proanBranding.productName}
            className="login-brand-mark-image"
            priority
            src={proanLogo}
          />
        </div>
        <h1>{proanBranding.loginTitle}</h1>
        <LoginForm />
      </section>
    </main>
  );
}

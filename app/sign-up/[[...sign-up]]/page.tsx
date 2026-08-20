import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <p className="type-flourish text-primary" aria-hidden>
        Sous
      </p>
      <SignUp />
    </main>
  );
}

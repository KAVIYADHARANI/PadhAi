import React, { useState } from "react";
import { BookOpen, LogIn, UserPlus, AlertCircle, Sparkles } from "lucide-react";
import { PRODUCT_NAME, TAGLINE, TAGLINE_TA } from "../brand";
import { useAuth } from "../contexts/AuthContext";
import { ThemeToggle } from "../components/ThemeToggle";

export const LoginPage: React.FC = () => {
  const { loginWithEmail, registerWithEmail, loginWithGoogle } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  // Quick helper for local emulator / development test
  const handleQuickDemoLogin = async () => {
    setEmail("student@example.com");
    setPassword("password123");
    setError(null);
    setLoading(true);
    try {
      try {
        await loginWithEmail("student@example.com", "password123");
      } catch {
        // If user doesn't exist yet in emulator, register
        await registerWithEmail("student@example.com", "password123");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app relative overflow-hidden transition-colors duration-150">
      {/* Top-right theme toggle */}
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle showLabel />
      </div>

      {/* Background soft glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 dark:bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 dark:bg-accent/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-in fade-in duration-200">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary-light border border-primary/20 items-center justify-center shadow-card mb-4">
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-heading">
            {PRODUCT_NAME}
          </h1>
          <p className="mt-1 text-sm text-muted font-medium">{TAGLINE}</p>
          <p className="mt-1 text-xs text-primary italic font-medium">"{TAGLINE_TA}"</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-2xl p-6 sm:p-8 shadow-card border border-line">
          <div className="flex rounded-xl bg-codeblock p-1 mb-6 border border-line">
            <button
              type="button"
              onClick={() => {
                setIsRegister(false);
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all min-h-[36px] ${
                !isRegister
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted hover:text-heading"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegister(true);
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all min-h-[36px] ${
                isRegister
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted hover:text-heading"
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-error-light border border-error/25 text-error text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-heading mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@example.com"
                className="w-full px-3.5 py-2.5 rounded-btn bg-subtle border border-line text-heading placeholder:text-muted text-sm focus:outline-none focus:border-primary focus:bg-surface transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-heading mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-btn bg-subtle border border-line text-heading placeholder:text-muted text-sm focus:outline-none focus:border-primary focus:bg-surface transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-btn text-sm font-semibold text-white bg-primary hover:bg-primary-hover shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px]"
            >
              {isRegister ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{loading ? "Registering..." : "Create Account"}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>{loading ? "Signing In..." : "Sign In"}</span>
                </>
              )}
            </button>
          </form>

          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <span className="relative px-3 text-xs text-muted bg-surface uppercase font-semibold">
              Or continue with
            </span>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-btn text-xs font-semibold text-body bg-surface border border-line hover:bg-subtle hover:border-primary/30 transition flex items-center justify-center gap-2 min-h-[44px]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google Account</span>
            </button>

            <button
              type="button"
              onClick={handleQuickDemoLogin}
              disabled={loading}
              className="w-full py-2 px-3 rounded-btn text-xs font-semibold text-primary bg-primary-light hover:opacity-90 border border-primary/25 transition flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Quick Demo Sign-In (Local Test)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

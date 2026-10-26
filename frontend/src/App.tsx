import React, { useState } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Navbar } from "./components/Navbar";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CoursePage } from "./pages/CoursePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { Course } from "./types";
import { Loader2 } from "lucide-react";

const MainContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [view, setView] = useState<"dashboard" | "privacy">("dashboard");

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-brand-500 animate-spin mb-4" />
        <p className="text-xs text-slate-400 font-medium">Initializing session...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (view === "privacy") {
    return <PrivacyPage onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      <Navbar
        onNavigateHome={() => {
          setSelectedCourse(null);
          setView("dashboard");
        }}
        onNavigatePrivacy={() => {
          setSelectedCourse(null);
          setView("privacy");
        }}
      />

      <main className="flex-1 pb-16">
        {selectedCourse ? (
          <CoursePage
            course={selectedCourse}
            onBack={() => setSelectedCourse(null)}
          />
        ) : (
          <DashboardPage
            onSelectCourse={(course) => setSelectedCourse(course)}
            onNavigatePrivacy={() => setView("privacy")}
          />
        )}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
};

export default App;

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
  const isPreview = typeof window !== "undefined" && window.location.search.includes("preview=course");
  const previewCourse: Course = {
    id: 1,
    user_id: 1,
    name: "Data Warehousing & Analytics",
    goal_days: 14,
    hours_per_day: 2,
    level: "intermediate",
    created_at: "2026-11-01T10:00:00Z",
  };

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(isPreview ? previewCourse : null);
  const [view, setView] = useState<"dashboard" | "privacy">("dashboard");

  if (loading && !isPreview) {
    return (
      <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <p className="text-sm text-slate-500 font-medium">Initializing session...</p>
      </div>
    );
  }

  if (!user && !isPreview) {
    return <LoginPage />;
  }

  if (view === "privacy") {
    return <PrivacyPage onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col text-[#334155]">
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

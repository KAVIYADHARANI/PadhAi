import React, { useState } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Navbar } from "./components/Navbar";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CoursePage } from "./pages/CoursePage";
import { Course } from "./types";
import { Loader2 } from "lucide-react";

const MainContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

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

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      <Navbar onNavigateHome={() => setSelectedCourse(null)} />

      <main className="flex-1 pb-16">
        {selectedCourse ? (
          <CoursePage
            course={selectedCourse}
            onBack={() => setSelectedCourse(null)}
          />
        ) : (
          <DashboardPage onSelectCourse={(course) => setSelectedCourse(course)} />
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

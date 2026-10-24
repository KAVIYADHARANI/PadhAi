/**
 * Firebase Client SDK Initialization & Authentication Services.
 *
 * Never puts Admin credentials or server secrets on the client.
 * Supports Firebase Auth Emulator in development via VITE_FIREBASE_AUTH_EMULATOR_HOST.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  type Auth,
  type User as FirebaseUser,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "mock-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "localhost",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-app",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "demo-app.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
};

// Singleton initialization
export const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth: Auth = getAuth(app);

// Connect to Auth emulator if configured in environment
const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  const emulatorUrl = emulatorHost.startsWith("http")
    ? emulatorHost
    : `http://${emulatorHost}`;
  try {
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    console.info(`[Auth] Connected to Firebase Auth Emulator at ${emulatorUrl}`);
  } catch (err) {
    // Emulator connection skipped or already initialized in HMR
    console.warn("[Auth] Emulator connection skipped or already initialized:", err);
  }
}

const googleProvider = new GoogleAuthProvider();

export async function loginWithEmail(email: string, pass: string): Promise<FirebaseUser> {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  return cred.user;
}

export async function registerWithEmail(email: string, pass: string): Promise<FirebaseUser> {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  return cred.user;
}

export async function loginWithGoogle(): Promise<FirebaseUser> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function logout(): Promise<void> {
  await firebaseSignOut(auth);
}

export async function getAuthToken(forceRefresh = false): Promise<string | null> {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }
  const current = auth.currentUser;
  if (!current) {
    return null;
  }
  return current.getIdToken(forceRefresh);
}

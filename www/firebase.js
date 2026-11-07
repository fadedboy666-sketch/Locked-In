
import { Capacitor } from '@capacitor/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

const firebaseConfig = {
  apiKey: "AIzaSyBiSgPe2fgHh-75uvneZdp8KoCACdSbIcQ",
  authDomain: "locked-in-ed224.firebaseapp.com",
  projectId: "locked-in-ed224",
  storageBucket: "locked-in-ed224.firebasestorage.app",
  messagingSenderId: "498563149400",
  appId: "1:498563149400:web:24abbc7c4644554896e42d",
  measurementId: "G-K3DTCF286N"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authPromise;

async function getFirebaseAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          return initializeAuth(app, {
            persistence: indexedDBLocalPersistence
          });
        } catch (error) {
          if (error.code === 'auth/already-initialized') {
            return getAuth(app);
          }
          throw error;
        }
      }
      return getAuth(app);
    })();
  }
  return authPromise;
}

const db = getFirestore(app);

async function signInWithGoogle() {
  const auth = await getFirebaseAuth();

  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle({
      skipNativeAuth: true
    });

    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Google sign-in did not return an ID token.');
    }

    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);
    return userCredential.user;
  }

  const provider = new GoogleAuthProvider();
  const userCredential = await signInWithPopup(auth, provider);
  return userCredential.user;
}

async function signOut() {
  const auth = await getFirebaseAuth();

  if (Capacitor.isNativePlatform()) {
    try {
      await FirebaseAuthentication.signOut();
    } finally {
      await firebaseSignOut(auth);
    }
  } else {
    await firebaseSignOut(auth);
  }
}

async function watchAuthState(callback) {
  const auth = await getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}

window.LockedInFirebase = {
  app,
  db,
  getAuth: getFirebaseAuth,
  signInWithGoogle,
  signOut,
  watchAuthState
};

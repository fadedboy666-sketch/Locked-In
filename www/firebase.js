import { Capacitor } from '@capacitor/core';
import { initializeApp, getApps, getApp } from 'firebase/app';

import {
  getAuth,
  getAdditionalUserInfo,
  initializeAuth,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'firebase/auth';

import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'firebase/firestore';

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
const cloudReadyUsers = new Set();
const saveTimers = {};
const pendingSaveData = {};
const savePromises = {};
const schedulingSaves = new Set();

function userDocument(uid) {
  return doc(db, 'users', uid, 'appData', 'main');
}

async function signInWithGoogle() {
  const auth = await getFirebaseAuth();
  let userCredential;

  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle({
      skipNativeAuth: true
    });

    const idToken = result.credential?.idToken;

    if (!idToken) {
      throw new Error('Google sign-in did not return an ID token.');
    }

    const credential = GoogleAuthProvider.credential(idToken);
    userCredential = await signInWithCredential(auth, credential);
  } else {
    const provider = new GoogleAuthProvider();
    userCredential = await signInWithPopup(auth, provider);
  }

  return {
    user: userCredential.user,
    isNewUser: !!getAdditionalUserInfo(userCredential)?.isNewUser
  };
}

async function syncUserData(localData) {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error('No signed-in user.');
  }

  const reference = userDocument(user.uid);
  const snapshot = await getDoc(reference);

  if (snapshot.exists()) {
    const cloudData = snapshot.data().data;

    if (!cloudData || typeof cloudData !== 'object') {
      throw new Error('Cloud backup data is invalid.');
    }

    cloudReadyUsers.add(user.uid);

    return {
      exists: true,
      data: cloudData
    };
  }

  await setDoc(reference, {
    data: localData || {},
    updatedAt: Date.now()
  });

  cloudReadyUsers.add(user.uid);

  return {
    exists: false,
    data: null
  };
}

function writeUserData(uid, data) {
  const previous = savePromises[uid] || Promise.resolve();

  const current = previous.catch(() => {}).then(() =>
    setDoc(userDocument(uid), {
      data,
      updatedAt: Date.now()
    })
  );

  savePromises[uid] = current;

  return current;
}

function saveUserData(data) {
  const task = (async () => {
    try {
      const auth = await getFirebaseAuth();
      const user = auth.currentUser;

      if (!user || !cloudReadyUsers.has(user.uid)) {
        return;
      }

      const uid = user.uid;

      pendingSaveData[uid] = data;

      clearTimeout(saveTimers[uid]);

      saveTimers[uid] = setTimeout(() => {
        const latest = pendingSaveData[uid];

        delete pendingSaveData[uid];
        delete saveTimers[uid];

        writeUserData(uid, latest).catch(error => {
          console.error('Cloud save failed:', error);
        });
      }, 1000);

    } catch (error) {
      console.error('Cloud save scheduling failed:', error);
    }
  })();

  schedulingSaves.add(task);

  task.then(() => schedulingSaves.delete(task));

  return task;
}

async function signOut() {
  const auth = await getFirebaseAuth();
  const uid = auth.currentUser?.uid;

  await Promise.all([...schedulingSaves]);

  if (uid) {
    clearTimeout(saveTimers[uid]);
    delete saveTimers[uid];

    if (
      Object.prototype.hasOwnProperty.call(
        pendingSaveData,
        uid
      )
    ) {
      const latest = pendingSaveData[uid];

      delete pendingSaveData[uid];

      await writeUserData(uid, latest);
    }

    if (savePromises[uid]) {
      await savePromises[uid];
    }

    cloudReadyUsers.delete(uid);
  }

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
  watchAuthState,
  syncUserData,
  saveUserData
};

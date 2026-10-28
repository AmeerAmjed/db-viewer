// localStorage can throw (private mode, blocked storage); the app must work without it.
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Per-tab storage: survives a reload, cleared when the tab closes
export function loadSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore (also when the schema is too big for the quota)
  }
}

export function removeSession(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

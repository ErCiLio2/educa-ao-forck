declare global {
  namespace App {
    interface Locals {
      token: string | null;
      user: { id: string; name: string; email: string; role: string } | null;
    }
    interface PageData {
      user?: App.Locals['user'];
    }
    // interface Error {}
    // interface Platform {}
  }
}

export {};

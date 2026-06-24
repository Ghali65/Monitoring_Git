"use server";

export async function verifyAdminCredentials(login: string, pass: string) {
  const expectedLogin = process.env.ADMIN_LOGIN || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  const powerbiUrl = process.env.POWERBI_URL || "https://github.com/Romain-Data/Digdash_cloner";

  if (login === expectedLogin && pass === expectedPassword) {
    return { success: true, url: powerbiUrl };
  } else {
    return { success: false };
  }
}

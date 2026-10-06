const u = (id: string, w = 160) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${w}&fit=crop&crop=faces&q=80&auto=format`;

export const profiles = {
  ahmed: { name: "Ahmed Raza Khan", avatar: u("1599257891200-693611501ecb"), initials: "AR" },
  ayesha: { name: "Ayesha Malik", avatar: u("1680506742421-7420d343bf68"), initials: "AM" },
  bilal: { name: "Bilal Hussain", avatar: u("1574281570877-bd815ebb50a4"), initials: "BH" },
  sana: { name: "Sana Riaz", avatar: u("1585906941558-6cf7eb1dfb40"), initials: "SR" },
  fahad: { name: "Fahad Qureshi", avatar: u("1663792816111-ae062758516e"), initials: "FQ" },
  hira: { name: "Hira Sheikh", avatar: u("1750164875377-8dd60996fc63"), initials: "HS" },
  usman: { name: "Usman Tariq", avatar: u("1692550691603-2929fd291f9a"), initials: "UT" },
  zainab: { name: "Zainab Iqbal", avatar: u("1702346339546-b76ae98c0d83"), initials: "ZI" },
} as const;

import dotenv from "dotenv";
dotenv.config({ override: true });
const key = process.env.OPENAI_API_KEY || "";
const masked = key && key.length>14 ? key.slice(0,6)+"..."+key.slice(-4) : key;
console.log("process.env.OPENAI_API_KEY (masked):", masked);

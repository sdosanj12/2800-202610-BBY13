require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);

async function test() {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent('Say hello in JSON: { "message": "..." }');
  console.log(result.response.text());
}

test().catch(console.error);
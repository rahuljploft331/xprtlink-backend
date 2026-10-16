/**
 * Creates Stripe Products + Prices for XprtLink subscription plans
 * and writes the resulting IDs back into the subscription_plans table via psql.
 */
import Stripe from 'stripe';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

function psql(sql) {
  const url = process.env.DATABASE_URL;
  // Parse postgresql://user:pass@host:port/db
  const m = url.match(/postgresql?:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d+)?\/([^?]+)/);
  const [, user, pass, host, port = '5432', db] = m;
  return execSync(`PGPASSWORD="${pass}" psql -h ${host} -p ${port} -U ${user} -d ${db} -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  });
}

const PLANS = [
  {
    code: 'core',
    name: 'Core',
    description: 'XprtLink Core membership — get discovered and take consultations.',
    price_monthly_cents: 999,
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'XprtLink Professional membership — grow your expert business.',
    price_monthly_cents: 2999,
  },
  {
    code: 'elite',
    name: 'Elite',
    description: 'XprtLink Elite membership — maximum visibility and tools.',
    price_monthly_cents: 4999,
  },
];

console.log('🔑 Stripe key:', process.env.STRIPE_SECRET_KEY?.slice(0, 14) + '...');
console.log('🗄️  DB:', process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, '://***@'));
console.log('');

for (const plan of PLANS) {
  process.stdout.write(`→ ${plan.name.padEnd(14)} ($${(plan.price_monthly_cents / 100).toFixed(2)}/mo)  `);

  // Find or create product
  const existing = await stripe.products.search({
    query: `metadata['xprtlink_plan_code']:'${plan.code}'`,
  });

  let product;
  if (existing.data.length > 0) {
    product = existing.data[0];
    process.stdout.write(`product reused   (${product.id})  `);
  } else {
    product = await stripe.products.create({
      name: `XprtLink ${plan.name}`,
      description: plan.description,
      metadata: { xprtlink_plan_code: plan.code },
    });
    process.stdout.write(`product created  (${product.id})  `);
  }

  // Find or create price
  const prices = await stripe.prices.list({ product: product.id, active: true });
  const existingPrice = prices.data.find(
    p => p.unit_amount === plan.price_monthly_cents && p.currency === 'usd' && p.recurring?.interval === 'month'
  );

  let price;
  if (existingPrice) {
    price = existingPrice;
    process.stdout.write(`price reused     (${price.id})\n`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.price_monthly_cents,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { xprtlink_plan_code: plan.code },
    });
    process.stdout.write(`price created    (${price.id})\n`);
  }

  // Write back to DB
  psql(
    `UPDATE subscription_plans SET stripe_price_id = '${price.id}', stripe_product_id = '${product.id}', updated_at = NOW() WHERE code = '${plan.code}'`
  );
}

// Verify
const result = psql(
  'SELECT code, stripe_price_id, stripe_product_id FROM subscription_plans ORDER BY price_monthly_cents'
);
console.log('\n✅ DB now has:');
console.log(result);

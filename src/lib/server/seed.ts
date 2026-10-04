// Seed plant catalog. Idempotent: upserts every catalog row with ON CONFLICT DO NOTHING.
import { plant } from './schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

type Sun = 'full' | 'partial' | 'shade';

const PLANTS: { name: string; family: string; emoji: string; spacing: number; sun: Sun }[] = [
	// Solanaceae (nightshades)
	{ name: 'Tomato', family: 'Solanaceae', emoji: '🍅', spacing: 1.5, sun: 'full' },
	{ name: 'Pepper', family: 'Solanaceae', emoji: '🌶️', spacing: 1, sun: 'full' },
	{ name: 'Eggplant', family: 'Solanaceae', emoji: '🍆', spacing: 1.5, sun: 'full' },
	{ name: 'Potato', family: 'Solanaceae', emoji: '🥔', spacing: 1, sun: 'full' },
	// Brassicaceae (brassicas)
	{ name: 'Kale', family: 'Brassicaceae', emoji: '🥬', spacing: 1, sun: 'full' },
	{ name: 'Broccoli', family: 'Brassicaceae', emoji: '🥦', spacing: 1.5, sun: 'full' },
	{ name: 'Cabbage', family: 'Brassicaceae', emoji: '🥬', spacing: 1.5, sun: 'full' },
	{ name: 'Cauliflower', family: 'Brassicaceae', emoji: '🥦', spacing: 1.5, sun: 'full' },
	{ name: 'Radish', family: 'Brassicaceae', emoji: '🌱', spacing: 0.25, sun: 'full' },
	{ name: 'Arugula', family: 'Brassicaceae', emoji: '🌿', spacing: 0.25, sun: 'partial' },
	{ name: 'Turnip', family: 'Brassicaceae', emoji: '🌱', spacing: 0.25, sun: 'full' },
	{ name: 'Brussels Sprouts', family: 'Brassicaceae', emoji: '🥦', spacing: 2, sun: 'full' },
	{ name: 'Kohlrabi', family: 'Brassicaceae', emoji: '🥬', spacing: 0.5, sun: 'full' },
	// Cucurbitaceae
	{ name: 'Cucumber', family: 'Cucurbitaceae', emoji: '🥒', spacing: 1, sun: 'full' },
	{ name: 'Zucchini', family: 'Cucurbitaceae', emoji: '🥒', spacing: 2, sun: 'full' },
	{ name: 'Pumpkin', family: 'Cucurbitaceae', emoji: '🎃', spacing: 3, sun: 'full' },
	{ name: 'Winter Squash', family: 'Cucurbitaceae', emoji: '🎃', spacing: 2, sun: 'full' },
	{ name: 'Melon', family: 'Cucurbitaceae', emoji: '🍈', spacing: 1.5, sun: 'full' },
	{ name: 'Watermelon', family: 'Cucurbitaceae', emoji: '🍉', spacing: 2, sun: 'full' },
	// Fabaceae (legumes)
	{ name: 'Bush Bean', family: 'Fabaceae', emoji: '🫘', spacing: 0.25, sun: 'full' },
	{ name: 'Pole Bean', family: 'Fabaceae', emoji: '🫘', spacing: 0.5, sun: 'full' },
	{ name: 'Pea', family: 'Fabaceae', emoji: '🫛', spacing: 0.25, sun: 'full' },
	// Amaryllidaceae (alliums)
	{ name: 'Onion', family: 'Amaryllidaceae', emoji: '🧅', spacing: 0.25, sun: 'full' },
	{ name: 'Garlic', family: 'Amaryllidaceae', emoji: '🧄', spacing: 0.5, sun: 'full' },
	{ name: 'Leek', family: 'Amaryllidaceae', emoji: '🧅', spacing: 0.25, sun: 'full' },
	{ name: 'Shallot', family: 'Amaryllidaceae', emoji: '🧅', spacing: 0.25, sun: 'full' },
	{ name: 'Chives', family: 'Amaryllidaceae', emoji: '🌿', spacing: 0.25, sun: 'full' },
	// Apiaceae
	{ name: 'Carrot', family: 'Apiaceae', emoji: '🥕', spacing: 0.25, sun: 'full' },
	{ name: 'Cilantro', family: 'Apiaceae', emoji: '🌿', spacing: 0.25, sun: 'partial' },
	{ name: 'Dill', family: 'Apiaceae', emoji: '🌿', spacing: 0.5, sun: 'full' },
	{ name: 'Parsley', family: 'Apiaceae', emoji: '🌿', spacing: 0.25, sun: 'partial' },
	// Asteraceae
	{ name: 'Lettuce', family: 'Asteraceae', emoji: '🥬', spacing: 0.25, sun: 'partial' },
	{ name: 'Endive', family: 'Asteraceae', emoji: '🥬', spacing: 0.5, sun: 'partial' },
	{ name: 'Sunflower', family: 'Asteraceae', emoji: '🌻', spacing: 1, sun: 'full' },
	// Amaranthaceae
	{ name: 'Spinach', family: 'Amaranthaceae', emoji: '🥬', spacing: 0.25, sun: 'partial' },
	{ name: 'Swiss Chard', family: 'Amaranthaceae', emoji: '🥬', spacing: 0.5, sun: 'partial' },
	{ name: 'Beet', family: 'Amaranthaceae', emoji: '🟤', spacing: 0.25, sun: 'full' },
	// Lamiaceae (herbs)
	{ name: 'Basil', family: 'Lamiaceae', emoji: '🌿', spacing: 0.25, sun: 'full' },
	{ name: 'Mint', family: 'Lamiaceae', emoji: '🌿', spacing: 0.5, sun: 'partial' },
	{ name: 'Thyme', family: 'Lamiaceae', emoji: '🌿', spacing: 0.25, sun: 'full' },
	{ name: 'Oregano', family: 'Lamiaceae', emoji: '🌿', spacing: 0.25, sun: 'full' },
	{ name: 'Rosemary', family: 'Lamiaceae', emoji: '🌿', spacing: 1.5, sun: 'full' },
	{ name: 'Sage', family: 'Lamiaceae', emoji: '🌿', spacing: 1, sun: 'full' },
	// Rosaceae
	{ name: 'Strawberry', family: 'Rosaceae', emoji: '🍓', spacing: 0.5, sun: 'full' },
	// Poaceae
	{ name: 'Sweet Corn', family: 'Poaceae', emoji: '🌽', spacing: 0.5, sun: 'full' }
];

export function seedPlants(db: DB): number {
	const result = db
		.insert(plant)
		.values(PLANTS.map((p) => ({ ...p })))
		.onConflictDoNothing()
		.run();
	return Number(result.changes);
}

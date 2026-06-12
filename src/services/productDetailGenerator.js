/**
 * productDetailGenerator — fills in missing PDP content (benefits, ingredients,
 * how-to-use, safety, specs, short description) for a product based on its
 * name / category / tags. Never overwrites seller-provided content.
 */

const BUCKETS = [
  {
    key: 'haircare',
    match: /shampoo|conditioner|hair\s?(oil|serum|mask|spa|cream|gel|wax|color|colour)|keratin|anti.?dandruff|scalp/i,
    ingredients: 'Aqua, Sodium Lauroyl Sarcosinate, Cocamidopropyl Betaine, Glycerin, Argan Oil (Argania Spinosa), Hydrolyzed Keratin, Vitamin E (Tocopheryl Acetate), Aloe Barbadensis Leaf Extract, Panthenol (Pro-Vitamin B5), Fragrance',
    activeIngredients: 'Argan Oil, Hydrolyzed Keratin, Pro-Vitamin B5',
    benefits: 'Deeply nourishes and strengthens hair from root to tip\nHelps reduce hair fall and breakage with regular use\nRestores natural shine and smoothness\nControls frizz and makes detangling easier\nSuitable for all hair types, including chemically treated hair',
    howToUse: '1. Apply to wet hair and massage gently into the scalp.\n2. Work the lather down to the tips of your hair.\n3. Leave on for 1–2 minutes so the actives can work.\n4. Rinse thoroughly with lukewarm water.\n5. Use 2–3 times a week for best results.',
    safety: 'For external use only. Avoid direct contact with eyes; if contact occurs, rinse immediately with water. Do a patch test before first use. Store in a cool, dry place away from direct sunlight. Keep out of reach of children.',
  },
  {
    key: 'skincare',
    match: /face\s?wash|cleanser|moisturi[sz]er|sunscreen|spf|face\s?(cream|gel|serum|mask|pack|scrub|toner)|night\s?cream|day\s?cream|body\s?(lotion|butter|wash)|soap|ubtan|vitamin\s?c|niacinamide|hyaluronic/i,
    ingredients: 'Aqua, Glycerin, Niacinamide, Aloe Barbadensis Leaf Juice, Hyaluronic Acid (Sodium Hyaluronate), Vitamin E (Tocopheryl Acetate), Green Tea Extract (Camellia Sinensis), Cetearyl Alcohol, Carbomer, Phenoxyethanol',
    activeIngredients: 'Niacinamide, Hyaluronic Acid, Vitamin E',
    benefits: 'Hydrates deeply and leaves skin soft and supple\nHelps brighten dull skin and even out skin tone\nLightweight, fast-absorbing and non-greasy formula\nSupports the skin barrier and locks in moisture\nDermatologically tested and suitable for daily use',
    howToUse: '1. Cleanse your face and pat dry.\n2. Take an adequate amount on your fingertips.\n3. Apply evenly over face and neck using gentle upward strokes.\n4. Use twice daily, morning and night, for visible results.',
    safety: 'For external use only. Avoid the delicate eye area. Patch test on the inner arm before first use. Discontinue use if irritation occurs. Store in a cool, dry place. Keep out of reach of children.',
  },
  {
    key: 'makeup',
    match: /lipstick|lip\s?(gloss|balm|liner|tint)|foundation|concealer|compact|kajal|eyeliner|mascara|eyeshadow|blush|highlighter|primer|nail\s?(polish|paint)|makeup|bb\s?cream|cc\s?cream/i,
    ingredients: 'Ricinus Communis (Castor) Seed Oil, Caprylic/Capric Triglyceride, Candelilla Wax, Vitamin E (Tocopheryl Acetate), Shea Butter (Butyrospermum Parkii), Mica, Titanium Dioxide, Iron Oxides, Fragrance',
    activeIngredients: 'Vitamin E, Shea Butter',
    benefits: 'Rich, highly pigmented colour in a single swipe\nLong-lasting, smudge-proof wear through the day\nEnriched with Vitamin E and Shea Butter to keep skin nourished\nLightweight, comfortable feel — never cakey or drying\nCruelty-free formulation',
    howToUse: '1. Start with clean, moisturised skin or lips.\n2. Apply evenly in smooth strokes, building coverage as desired.\n3. For sharper definition, outline first and then fill in.\n4. Remove at the end of the day with a gentle makeup remover.',
    safety: 'For external use only. Do a patch test before first use. Discontinue use if redness or irritation develops. Replace the cap tightly after use and store away from heat and direct sunlight.',
  },
  {
    key: 'fragrance',
    match: /perfume|eau\s?de|fragrance|deodorant|deo\b|body\s?mist|attar|cologne/i,
    ingredients: 'Alcohol Denat., Parfum (Fragrance), Aqua, Top Notes of Citrus and Bergamot, Heart Notes of Jasmine and Rose, Base Notes of Musk, Amber and Sandalwood',
    activeIngredients: null,
    benefits: 'Long-lasting fragrance that stays with you all day\nWell-balanced top, heart and base notes that evolve beautifully\nPerfect for daily wear as well as special occasions\nCompact, travel-friendly packaging\nSuitable for both day and evening wear',
    howToUse: '1. Spray from 10–15 cm away onto pulse points — wrists, neck and behind the ears.\n2. Do not rub after applying; let the fragrance settle naturally.\n3. Re-apply lightly during the day if desired.\n4. For longer wear, apply on moisturised skin.',
    safety: 'Flammable — keep away from heat, flame and direct sunlight. For external use only. Avoid spraying near eyes or on broken or irritated skin. Keep out of reach of children.',
  },
  {
    key: 'tools',
    match: /dryer|straightener|curler|trimmer|shaver|epilator|brush|comb|roller|massager|mirror|scissor|clipper|applicator|sponge|blender\b/i,
    ingredients: null,
    activeIngredients: null,
    benefits: 'Professional salon-quality results at home\nErgonomic, easy-grip design for comfortable everyday use\nDurable build quality made to last\nEasy to clean and maintain\nTravel-friendly and lightweight',
    howToUse: '1. Read the included instructions before first use.\n2. Use on clean, dry (or towel-dried, as directed) hair or skin.\n3. Work in small sections for an even, professional finish.\n4. Clean the product after every use and store it in a dry place.',
    safety: 'Keep away from water unless the product is explicitly waterproof. Unplug electrical tools after use and allow hot surfaces to cool before storing. Keep out of reach of children.',
  },
  {
    key: 'accessories',
    match: /bag|handbag|purse|wallet|clutch|pouch|tote|sling|backpack|jewell?ery|earring|necklace|bracelet|scarf|belt|sunglass|watch/i,
    ingredients: null,
    activeIngredients: null,
    benefits: 'Premium finish that elevates any outfit\nSpacious, well-organised compartments for your essentials\nSturdy stitching and hardware built for daily use\nComfortable to carry with a versatile, timeless design\nPairs effortlessly with both casual and formal looks',
    howToUse: '1. Wipe with a soft, dry cloth to keep the surface clean.\n2. Avoid prolonged exposure to water and direct sunlight.\n3. Store in the provided dust bag or a cool, dry place when not in use.\n4. Avoid overloading to retain the original shape.',
    safety: 'Keep away from sharp objects to prevent scratches. Colours may vary slightly due to photography lighting. Spot-clean only; do not machine wash.',
  },
];

const GENERIC = {
  key: 'generic',
  ingredients: null,
  activeIngredients: null,
  benefits: 'Carefully curated, quality-checked product\nMade with premium materials and trusted processes\nGreat value for money\nLoved by customers across India\nBacked by easy returns as per the seller policy',
  howToUse: '1. Read the label and any included instructions before use.\n2. Use as directed for best results.\n3. Store in a cool, dry place away from direct sunlight.',
  safety: 'Use only as directed on the label. Keep out of reach of children. Store in a cool, dry place.',
};

function pickBucket(product) {
  const hay = [
    product.name,
    product.description,
    product.brand,
    ...(product.tags || []),
    typeof product.category === 'object' ? product.category?.name : product.category,
  ].filter(Boolean).join(' ');
  return BUCKETS.find((b) => b.match.test(hay)) || GENERIC;
}

/**
 * Returns an object of ONLY the fields that are currently empty and should be
 * filled. Empty object → nothing to update.
 */
function generateMissingDetails(product) {
  const bucket = pickBucket(product);
  const upd = {};
  const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

  if (isEmpty(product.shortDescription) && product.name) {
    upd.shortDescription = `${product.name}${product.brand ? ` by ${product.brand}` : ''} — premium quality, handpicked for you by GlamCos.`;
  }
  if (isEmpty(product.benefits) && bucket.benefits) upd.benefits = bucket.benefits;
  if (isEmpty(product.howToUse) && bucket.howToUse) upd.howToUse = bucket.howToUse;
  if (isEmpty(product.ingredients) && bucket.ingredients) upd.ingredients = bucket.ingredients;
  if (isEmpty(product.activeIngredients) && bucket.activeIngredients) upd.activeIngredients = bucket.activeIngredients;
  if (isEmpty(product.safetyInstructions) && bucket.safety) upd.safetyInstructions = bucket.safety;
  if (isEmpty(product.countryOfOrigin)) upd.countryOfOrigin = 'India';

  if (!Array.isArray(product.specifications) || product.specifications.length === 0) {
    const specs = [];
    if (product.brand) specs.push({ key: 'Brand', value: product.brand });
    specs.push({ key: 'Product Type', value: bucket.key === 'generic' ? 'Lifestyle Product' : bucket.key.charAt(0).toUpperCase() + bucket.key.slice(1) });
    if (product.weight?.value) specs.push({ key: 'Net Weight', value: `${product.weight.value} ${product.weight.unit || 'g'}` });
    if (product.volume?.value) specs.push({ key: 'Net Volume', value: `${product.volume.value} ${product.volume.unit || 'ml'}` });
    if (product.sku) specs.push({ key: 'SKU', value: product.sku });
    specs.push({ key: 'Country of Origin', value: product.countryOfOrigin || 'India' });
    upd.specifications = specs;
  }

  return { bucket: bucket.key, updates: upd };
}

module.exports = { generateMissingDetails, pickBucket };

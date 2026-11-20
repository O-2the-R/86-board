// Made-up lists for the three sample restaurants, so the demo and the
// preview can show "Ask" without any real restaurant's data. The dishes match
// the sample menus in ../sample-data.ts by name, which is how the chat knows
// what is 86'd. Every allergy mark here is invented for the demo.
import type { AllergenKey, AssistantCatalog, AssistantItem, ItemKind, Marks } from './catalog';

// [name, section, what is in it, avoid marks, ask marks]; marks read "key: reason; key: reason"
type Row = [name: string, section: string, about: string, avoid?: string, ask?: string];

function marksOf(s: string | undefined): Marks | undefined {
  if (!s) return undefined;
  const marks: Marks = {};
  for (const part of s.split('; ')) {
    const at = part.indexOf(': ');
    marks[part.slice(0, at) as AllergenKey] = part.slice(at + 2);
  }
  return marks;
}

const rows = (kind: ItemKind, list: Row[]): AssistantItem[] =>
  list.map(([name, section, about, avoid, ask]) => ({ name, kind, section, about, avoid: marksOf(avoid), ask: marksOf(ask) }));

const wine = (name: string, section: string, about: string, glass: number, bottle: number, board?: string): AssistantItem => ({
  name,
  kind: 'wine',
  section,
  about,
  prices: { glass, bottle },
  board,
});

const SERVICE = {
  title: 'Steps of service (sample)',
  asOf: 'sample',
  text: 'Water on the table within one minute. Name the specials and anything 86\'d before taking the order. Ask every table about allergies. Write an allergy on the ticket, then tell the kitchen and the bar in person.',
};

const MAIN: AssistantCatalog = {
  restaurantId: 'main',
  name: 'Ask',
  venue: 'Main Street, a full-service Italian-American restaurant (a sample restaurant with made-up lists)',
  asOf: 'Sample lists, made up for the demo',
  items: [
    ...rows('food', [
      ['Burrata & Peach', 'Starters', 'Burrata, grilled peach, basil oil, grilled bread', 'dairy: Burrata is fresh cheese.; gluten: Served with grilled bread.', 'nuts: The basil oil is sometimes a pesto with pine nuts.'],
      ['Tuna Crudo', 'Starters', 'Raw yellowfin tuna, orange, chili, olive oil', 'fish: Raw tuna.; citrus: Orange dressing.; capsicum: Fresh chili.'],
      ['Crispy Calamari', 'Starters', 'Fried squid, lemon aioli, marinara', 'shellfish: Squid.; gluten: Dredged in flour.; egg: The aioli is made with egg.; nightshade: Marinara is tomato.; citrus: Lemon in the aioli.', 'fish: Fried in the same oil as fish.'],
      ['Caesar', 'Starters', 'Romaine, parmesan, croutons, anchovy dressing', 'fish: Anchovy in the dressing.; egg: Egg in the dressing.; dairy: Parmesan.; gluten: Croutons.'],
      ['Tagliatelle Bolognese', 'Pasta', 'Egg pasta, beef and pork ragù, parmesan', 'gluten: Wheat pasta.; egg: Egg pasta.; pork: Pork in the ragù.; dairy: Finished with butter and parmesan.; nightshade: Tomato.; allium: Onion and garlic in the ragù.', 'alcohol: The ragù is cooked with wine.'],
      ['Cacio e Pepe', 'Pasta', 'Spaghetti, pecorino, black pepper', 'gluten: Wheat pasta.; dairy: Pecorino.'],
      ['Lobster Ravioli', 'Pasta', 'Lobster ravioli, tomato cream', 'shellfish: Lobster.; gluten: Wheat pasta.; egg: Egg pasta.; dairy: Cream sauce.; nightshade: Tomato.'],
      ['Pan-Roasted Halibut', 'Mains', 'Halibut, white beans, lemon butter', 'fish: Halibut.; dairy: Butter sauce.; legumes: White beans.; citrus: Lemon.'],
      ['Braised Short Rib', 'Mains', 'Beef short rib, soft polenta, red wine jus', 'dairy: The polenta is finished with butter and cheese.; allium: Onion and garlic in the braise.', 'alcohol: Braised in red wine.'],
      ['Whole Branzino', 'Mains', 'Grilled branzino, lemon, herbs', 'fish: Branzino.; citrus: Lemon.'],
      ['Ribeye 16 oz', 'Mains', 'Grilled ribeye, herb butter', 'dairy: Finished with herb butter.'],
      ['Roast Chicken', 'Mains', 'Half chicken, pan jus, roast potatoes', 'nightshade: Potatoes.; allium: Garlic.', 'dairy: The jus is sometimes finished with butter.'],
      ['Tiramisu', 'Desserts', 'Mascarpone, espresso-soaked ladyfingers, cocoa', 'dairy: Mascarpone.; egg: Egg in the cream.; gluten: Ladyfingers.; coffee: Espresso.; cocoa: Cocoa on top.; alcohol: Marsala.'],
      ['Olive Oil Cake', 'Desserts', 'Olive oil cake, orange, whipped cream', 'gluten: Wheat flour.; egg: Egg.; dairy: Whipped cream.; citrus: Orange zest.', 'nuts: Some batches use almond flour.'],
    ]),
    ...rows('drink', [
      ['Espresso Martini', 'Cocktails', 'Vodka, espresso, coffee liqueur', 'alcohol: Vodka and coffee liqueur.; coffee: Espresso.'],
      ['Negroni', 'Cocktails', 'Gin, Campari, sweet vermouth, orange peel', 'alcohol: Gin, Campari and vermouth.; citrus: Orange peel.'],
      ['Lemon Basil Soda', 'No alcohol', 'Lemon, basil syrup, soda water', 'citrus: Lemon.'],
    ]),
    wine('Pinot Noir, Willamette Valley', 'Red', 'light and silky', 15, 58, 'Pinot Noir (glass)'),
    wine('Chianti Classico', 'Red', 'medium-bodied, cherry and spice', 14, 54),
    wine('Pinot Grigio, Alto Adige', 'White', 'crisp and dry', 12, 46),
    wine('Prosecco', 'Sparkling', 'dry and bright', 12, 48),
  ],
  docs: [
    {
      title: 'Bar manual (sample)',
      asOf: 'sample',
      text: 'Negroni: 1 oz gin, 1 oz Campari, 1 oz sweet vermouth. Stir over ice, strain over one large cube, orange peel.\nEspresso Martini: 1.5 oz vodka, 1 oz fresh espresso, 0.75 oz coffee liqueur. Shake hard, strain into a coupe, three coffee beans.\nLemon Basil Soda: 1 oz lemon juice, 0.75 oz basil syrup, top with soda water over ice, basil leaf.',
    },
    SERVICE,
  ],
  starters: ['Shellfish allergy. Is the Crispy Calamari OK?', 'A red by the glass', "What is 86'd right now?", 'How do we make the Negroni?', 'Something with no alcohol'],
};

const WATER: AssistantCatalog = {
  restaurantId: 'water',
  name: 'Ask',
  venue: 'Waterfront, a full-service seafood restaurant (a sample restaurant with made-up lists)',
  asOf: 'Sample lists, made up for the demo',
  items: [
    ...rows('food', [
      ['Oysters, East Coast', 'Raw Bar', 'Half dozen, mignonette, lemon', 'shellfish: Oysters.; citrus: Lemon.; allium: Shallot in the mignonette.'],
      ['Oysters, West Coast', 'Raw Bar', 'Half dozen, mignonette, lemon', 'shellfish: Oysters.; citrus: Lemon.; allium: Shallot in the mignonette.'],
      ['Shrimp Cocktail', 'Raw Bar', 'Poached shrimp, cocktail sauce, lemon', 'shellfish: Shrimp.; nightshade: Tomato in the cocktail sauce.; citrus: Lemon.', 'fish: The cocktail sauce has Worcestershire, which is made with anchovy.'],
      ['Crab Cake', 'Starters', 'Lump crab, mustard aioli', 'shellfish: Crab.; egg: Egg binds the cake and the aioli.; gluten: Breadcrumbs.'],
      ['Clam Chowder', 'Starters', 'Clams, potato, bacon, cream', 'shellfish: Clams.; dairy: Cream.; pork: Bacon.; nightshade: Potato.; allium: Onion.', 'gluten: The chowder is sometimes thickened with flour.'],
      ['Lobster Roll', 'Mains', 'Lobster, mayonnaise, buttered roll, fries', 'shellfish: Lobster.; gluten: Roll.; egg: Mayonnaise.; dairy: The roll is toasted in butter.; nightshade: Fries.'],
      ['Grilled Swordfish', 'Mains', 'Swordfish, tomato and caper relish', 'fish: Swordfish.; nightshade: Tomato.'],
      ['Seared Scallops', 'Mains', 'Scallops, sweet corn, brown butter', 'shellfish: Scallops.; dairy: Brown butter.'],
      ['Steak Frites', 'Mains', 'Hanger steak, fries, garlic butter', 'dairy: Garlic butter.; nightshade: Fries.; allium: Garlic.', 'shellfish: The fries share a fryer with shellfish.'],
      ['Fish & Chips', 'Mains', 'Beer-battered cod, fries, tartar sauce', 'fish: Cod.; gluten: Beer batter.; egg: Tartar sauce.; nightshade: Fries.; alcohol: Beer in the batter.'],
      ['Truffle Fries', 'Sides', 'Fries, truffle oil, parmesan', 'nightshade: Potato.; dairy: Parmesan.; mushroom: Truffle oil.', 'shellfish: The fries share a fryer with shellfish.'],
      ['Grilled Asparagus', 'Sides', 'Asparagus, lemon, olive oil', 'citrus: Lemon.'],
    ]),
    ...rows('drink', [['Aperol Spritz', 'Cocktails', 'Aperol, prosecco, soda, orange', 'alcohol: Aperol and prosecco.; citrus: Orange.']]),
    wine('Sancerre', 'White', 'crisp, citrus and mineral', 17, 66, 'Sancerre (glass)'),
    wine('Chablis', 'White', 'dry and lean', 16, 62),
    wine('Rosé, Provence', 'Rosé', 'dry and light', 13, 50),
  ],
  docs: [{ title: 'Bar manual (sample)', asOf: 'sample', text: 'Aperol Spritz: 3 oz prosecco, 2 oz Aperol, 1 oz soda water. Build over ice in a wine glass, orange slice.' }, SERVICE],
  starters: ['Shellfish allergy at table 4. What can they have?', 'A white for the swordfish', "What is 86'd right now?", 'How do we make the Aperol Spritz?'],
};

const COUNTER: AssistantCatalog = {
  restaurantId: 'counter',
  name: 'Ask',
  venue: 'The Counter, a fast-casual restaurant with bowls and sandwiches (a sample restaurant with made-up lists)',
  asOf: 'Sample lists, made up for the demo',
  items: [
    ...rows('food', [
      ['Chicken Shawarma Bowl', 'Bowls', 'Chicken, rice, pickled onion, garlic sauce', 'allium: Garlic sauce and pickled onion.; egg: The garlic sauce is made with egg.', 'sesame: The marinade sometimes has tahini.'],
      ['Falafel Bowl', 'Bowls', 'Falafel, rice, tomato, tahini', 'legumes: Falafel is chickpea.; sesame: Tahini.; nightshade: Tomato.; allium: Garlic and onion in the falafel.', 'gluten: The falafel shares a fryer with breaded items.'],
      ['Steak Bowl', 'Bowls', 'Grilled steak, rice, peppers, chimichurri', 'capsicum: Peppers.; nightshade: Peppers.; allium: Garlic in the chimichurri.'],
      ['Chicken Pesto', 'Sandwiches', 'Chicken, basil pesto, mozzarella, ciabatta', 'gluten: Ciabatta.; dairy: Mozzarella and parmesan in the pesto.; nuts: Pine nuts in the pesto.; allium: Garlic in the pesto.'],
      ['Italian Sub', 'Sandwiches', 'Salami, ham, provolone, peppers, sub roll', 'gluten: Sub roll.; pork: Salami and ham.; dairy: Provolone.; capsicum: Pickled peppers.; nightshade: Peppers and tomato.'],
      ['Veggie Wrap', 'Sandwiches', 'Hummus, cucumber, tomato, greens, flour tortilla', 'gluten: Flour tortilla.; legumes: Hummus is chickpea.; sesame: Tahini in the hummus.; nightshade: Tomato.'],
      ['Fries', 'Sides', 'Fries, sea salt', 'nightshade: Potato.', 'gluten: The fries share a fryer with breaded items.'],
      ['Side Salad', 'Sides', 'Greens, tomato, lemon vinaigrette', 'nightshade: Tomato.; citrus: Lemon vinaigrette.'],
      ['Hummus & Pita', 'Sides', 'Hummus, olive oil, warm pita', 'legumes: Chickpea.; sesame: Tahini.; gluten: Pita.; allium: Garlic.; citrus: Lemon.'],
    ]),
    ...rows('drink', [
      ['Lemonade', 'Drinks', 'Lemon, sugar, water', 'citrus: Lemon.'],
      ['Cold Brew', 'Drinks', 'Cold-brewed coffee', 'coffee: Coffee.'],
      ['Sparkling Water', 'Drinks', 'Sparkling water'],
    ]),
  ],
  docs: [SERVICE],
  starters: ['Sesame allergy. Which bowls are out?', 'What is in the Chicken Pesto?', "What is 86'd right now?", 'A drink with no caffeine'],
};

export const SAMPLE_CATALOGS: Record<string, AssistantCatalog> = { main: MAIN, water: WATER, counter: COUNTER };

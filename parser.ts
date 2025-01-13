import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

const ENERGY_SET = 'SVE';

type InitialFileParse = {
    totalCards: number;
    totalPokemon: number;
    totalTrainer: number;
    totalEnergy: number;
    pokemon: string[];
    trainer: string[];
    energy: string[];
};

type CardParts = {
    quant: number;
    name: string;
    set: string;
    id: number;
    mod: string | null;
};

const EnergyIds = {
    G: 9,
    R: 10,
    W: 11,
    L: 12,
    P: 13,
    F: 14,
    D: 15,
    M: 16,
} as const;

const SetSearchResponse = z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    count: z.number().int(),
    totalCount: z.number().int(),
    data: z.array(z.object({ id: z.string() }).passthrough()),
});

const setIds = new Map<string, string[]>();

const initialParseFile = (fileLines: string[]): Omit<InitialFileParse, `total${string}`> => {
    type ReduceAcc = InitialFileParse & { currentKey: keyof Omit<InitialFileParse, `total${string}`> };
    const { currentKey: _, energy, pokemon, totalCards, totalEnergy, totalPokemon, totalTrainer, trainer } = fileLines.reduce((acc: ReduceAcc, line) => {
        const totalCardsMatch = /^\s*Total\s+Cards:\s+(\d+)\s*$/.exec(line);
        if (totalCardsMatch !== null) {
            return { ...acc, totalCards: Number(totalCardsMatch[1]) };
        }
        const totalPokemonMatch = /\s*Pokémon:\s+(\d+)\s*$/.exec(line);
        if (totalPokemonMatch !== null) {
            return { ...acc, currentKey: 'pokemon', totalPokemon: Number(totalPokemonMatch[1]) } satisfies ReduceAcc;
        }
        const totalTrainerMatch = /\s*^Trainer:\s+(\d+)$\s*/.exec(line);
        if (totalTrainerMatch !== null) {
            return { ...acc, currentKey: 'trainer', totalTrainer: Number(totalTrainerMatch[1]) } satisfies ReduceAcc;
        }
        const totalEnergyMatch = /\s*^Energy:\s+(\d+)$\s*/.exec(line);
        if (totalEnergyMatch !== null) {
            return { ...acc, currentKey: 'energy', totalEnergy: Number(totalEnergyMatch[1]) } satisfies ReduceAcc;
        }
        acc[acc.currentKey].push(line);
        return acc;
    }, { totalCards: 0, totalPokemon: 0, totalTrainer: 0, totalEnergy: 0, pokemon: [], trainer: [], energy: [], currentKey: 'pokemon' });
    if (totalPokemon !== pokemon.length) throw new Error("Mismatch Pokemon Length");
    if (totalTrainer !== trainer.length) throw new Error("Mismatch Trainer Length");
    if (totalEnergy !== energy.length) throw new Error("Mismatch Energy Length");
    if ((totalEnergy + totalTrainer + totalPokemon) > totalCards) throw new Error("Invalid total card count")
    return { pokemon, trainer, energy };
};

const getCardParts = (card: string) => {
    const cardMatch = card.match(/^(\d+)\s+(.+)\s+(.+?)\s+(\d+)(\s+(.+))?$/);
    if (cardMatch === null) throw new Error(`Unrecoginized card: ${card}`);
    const [, quant, name, set, id, , mod] = cardMatch;
    const energyMatch = name!.match(/^Basic\s+\{(.+?)}\s+Energy$/);
    return {
        quant: Number(quant),
        name: name!,
        set: energyMatch !== null ? ENERGY_SET : set!,
        id: energyMatch !== null ? (EnergyIds[energyMatch[1] as keyof (typeof EnergyIds)]) : Number(id),
        mod: mod ?? null
    };
};

const fetchFromAPI = async <T extends z.ZodRawShape>(url: string, parser: z.ZodObject<T>): Promise<z.infer<z.ZodObject<T>>> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url}: ${response.status}: ${response.statusText}\n${await response.text()}`);
    }
    const data = await response.json();
    try {
        return parser.parse(data);
    } catch (e) {
        console.dir(data, {depth: null, maxArrayLength: null});
        throw e;
    }
}

const fetchRedirectLocation = async (url: string) => {
    const response = await fetch(url, { redirect: 'manual' });
    const code = Math.floor(response.status / 100);
    if (code > 3) {
        console.error(await response.text);
        throw new Error(`${response.status}: ${response.statusText}`);
    }
    if (code < 3 || !response.headers.get('location')) {
        throw new Error("Did not redirect.");
    }
    return response.headers.get('location') ?? '';
}

const mapLiveSetIdToAPISetId = async (set: string) => {
    if (setIds.has(set.trim().toLowerCase())) return setIds.get(set.trim().toLowerCase())!;
    const setData = await fetchFromAPI(`https://api.pokemontcg.io/v2/sets?q=ptcgoCode:${set.toLowerCase()}`, SetSearchResponse);
    if (setData.data.length === 0) {
        throw new Error(`Invalid set id: ${set}.`);
    }
    const ids = setData.data.map(({id}) => id);
    return ids;
}

const fetchCardDetails = async ({ set, id }: CardParts) => {
    const cardParser = z.object({ data: z.object({ tcgplayer: z.object({ url: z.string() }).passthrough() }) });
    let card: (z.infer<typeof cardParser>)['data'] | null = null;
    const sets = await mapLiveSetIdToAPISetId(set);
    for (let i = 0; i < sets.length && card === null; i++) {
        try {
            const setId = sets[i];
            const cardId = `${setId}-${id}`.trim().toLowerCase();
            card = (await fetchFromAPI(`https://api.pokemontcg.io/v2/cards/${cardId}`, cardParser)).data;
        } catch (e) {
            if (i === sets.length - 1) throw e;
            card = null;
        }
    }
    if (card === null) throw new Error("card is null");
    const tcgplayerUrl = await fetchRedirectLocation(card.tcgplayer.url);
    const productIdMatch = tcgplayerUrl.match(/^.*?product\/(.+?)\s*$/);
    if (!productIdMatch) {
        throw new Error(`Invalid TCG Player URL ${tcgplayerUrl}`);
    }
    return {
        productId: productIdMatch[1]!
    }
};

const parseCard = async (card: string) => {
    const cardParts = getCardParts(card);
    const {productId} = await fetchCardDetails(cardParts);
    return {
        productId,
        quant: cardParts.quant
    }
}

const parseCards = async (cards: Omit<InitialFileParse, `total${string}`>) => {
    const massEntryList:string[] = [];
    const entries: Map<string, number> = new Map();
    for (const pokemon of cards.pokemon) {
        const {productId, quant} = await parseCard(pokemon);
        entries.set(productId, (entries.get(productId) ?? 0) + quant);
    }
    for (const trainer of cards.trainer) {
        const {productId, quant} = await parseCard(trainer);
        entries.set(productId, (entries.get(productId) ?? 0) + quant);
    }
    for (const energy of cards.energy) {
        const {productId, quant} = await parseCard(energy);
        entries.set(productId, (entries.get(productId) ?? 0) + quant);
    }
    console.log(`https://www.tcgplayer.com/massentry?c=${[...entries.entries()].map(([productId, quant]) => `${quant}-${productId}`).join('||')}&productline=Pokemon`)
}

const [, , filename] = process.argv;

if (!filename) {
    console.error("Usage: node start -- <filename>")
    process.exit(1);
}

const fileText = (await fs.readFile(path.join(process.cwd(), filename), 'utf-8'))
    .replaceAll(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

console.log(fileText);


await parseCards(initialParseFile(fileText));


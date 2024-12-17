import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type InitialFileParse = {
    totalCards: number;
    totalPokemon: number;
    totalTrainer: number;
    totalEnergy: number;
    pokemon: string[];
    trainer: string[];
    energy: string[];
};

const initialParseFile = (fileLines: string[]): Omit<InitialFileParse, `total${string}`> => {
    type ReduceAcc = InitialFileParse & { currentKey: keyof Omit<InitialFileParse, `total${string}`> };
    const { currentKey: _, energy, pokemon, totalCards, totalEnergy, totalPokemon, totalTrainer,trainer } = fileLines.reduce((acc: ReduceAcc, line) => {
        const totalCardsMatch = /^\s*Total\s+Cards:\s+(\d+)\s*$/.exec(line);
        if (totalCardsMatch !== null) {
            return { ...acc, totalCards: Number(totalCardsMatch[1]) };
        }
        const totalPokemonMatch = /\s*Pokémon:\s+(\d+)\s*$/.exec(line);
        if (totalPokemonMatch !== null) {
            return {...acc, currentKey: 'pokemon', totalPokemon: Number(totalPokemonMatch[1])} satisfies ReduceAcc;
        }
        const totalTrainerMatch = /\s*^Trainer:\s+(\d+)$\s*/.exec(line);        
        if (totalTrainerMatch !== null) {
            return {...acc, currentKey: 'trainer', totalTrainer: Number(totalTrainerMatch[1])} satisfies ReduceAcc;
        }
        const totalEnergyMatch = /\s*^Energy:\s+(\d+)$\s*/.exec(line);
        if (totalEnergyMatch !== null) {
            return {...acc, currentKey: 'energy', totalEnergy: Number(totalEnergyMatch[1])} satisfies ReduceAcc;
        }
        acc[acc.currentKey].push(line);
        return acc;
    }, { totalCards: 0, totalPokemon: 0, totalTrainer: 0, totalEnergy: 0, pokemon: [], trainer: [], energy: [], currentKey: 'pokemon' });
    if (totalPokemon !== pokemon.length) throw new Error("Mismatch Pokemon Length");
    if (totalTrainer !== trainer.length) throw new Error("Mismatch Trainer Length");
    if (totalEnergy !== energy.length) throw new Error("Mismatch Energy Length");
    if ((totalEnergy + totalTrainer + totalPokemon) > totalCards) throw new Error("Invalid total card count")
    return {pokemon, trainer, energy};
};

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


const parsedFile = initialParseFile(fileText);
console.log(parsedFile);

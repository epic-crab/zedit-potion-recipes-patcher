/*global ngapp, xelib*/
const baseFilename = 'AlchemistsCookbook.esp',
	logName = 'AC',
	totalProgress = 1,
	usedEdids = {},
	excludedIngredients = [
		'Skyrim.esm/FavorThadgeirAshes',
		'ccEDHSSE002-SplKntSet.esl/ccEDHSSE002_CorruptedHumanHeart',
		'ccEDHSSE002-SplKntSet.esl/ccEDHSSE002_HumanHeart'
	],
	skillLevels = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'],
	recipeRegex = /(Pure|Impure)(\d)/;
	
//=include vanillaRecipes.js

let executeRecipePatcher = (patchFile, helpers, settings, locals) => {
	const baseFile = xelib.FileByName(baseFilename);
	//=include MLQtil.js
	//=include recipeFunctions.js
	return {
		customProgress: (filesToPatch) => totalProgress,
		initialize: (patchFile, helpers, settings, locals) => {
			locals.templateRecipeNote = GetRecord(baseFile, 0x05000800);
			locals.leveledLists = getLeveledItems();
			locals.excludedIngredients = getExcludedIngredients();
			//load all ingredients, and all effects they use
			locals.ingredients = getIngredientObjects();
			locals.effects = getIngredientMagicEffects();
			//find combinations of ingredients, evaluate results, cull garbage, create records
			let validCombinations = getAllCombinations(locals.ingredients, locals.effects);
			let recipeObject = buildRecipeObject(validCombinations);
			deleteImpureRecipesBelowThreshold(recipeObject, parseInt(settings.impureThreshold));
			if(settings.serialize) serializeRecipeObject(recipeObject);
			
			let allRecipes = getAllRecipes(recipeObject);
			const count = allRecipes.length;
			const indivProgress = totalProgress/count/2;
			debugMessage(`Creating leveled lists for new recipes`);
			constructNewLeveledLists(recipeObject);
			debugMessage(`${count} recipes will be created`);
			
			//create notes and assign to lists
			let allNotes = allRecipes.map(recipe => {
				let vanillaRecipe = vanillaRecipes.find(vRecipe => {
					if(vRecipe.ingredients.length !== recipe.ingredients.length) return false;
					return recipe.ingredients.map(ing => ing.uid).every(id => vRecipe.ingredients.includes(id));
				});
				let note;
				if(vanillaRecipe) {
					let formID = vanillaRecipe.formID;
					note = createRecipeNote(recipe, formID);
				} else note = createRecipeNote(recipe);
				helpers.addProgress(indivProgress);
				return note;
			});
			debugMessage(`Recipes created. Assigning to leveled lists`);
			allNotes.forEach((note, index) => {
				let recipe = allRecipes[index];
				assignNoteToRecipeList(note, recipe);
				helpers.addProgress(indivProgress);
			});
		},
		process: [{
			records: () => Object.values(locals.leveledLists.groups),
			patch: patchRecsBySkill
		}]
	};
};

registerPatcher({
	info: info,
	gameModes: [xelib.gmTES5, xelib.gmSSE],
	settings: {
		label: 'Alchemist\'s Cookbook Patcher',
        templateUrl: `${patcherUrl}/partials/settings.html`,
		defaultSettings: {
			impureThreshold: '3',
			excludeJarrinRoot: true,
			excludeSaSItems: true,
			showDebugMessages: true
		}
	},
	requiredFiles: () => [baseFilename],
	getFilesToPatch: function(filenames) {
        return filenames;
    },
	execute: executeRecipePatcher
});
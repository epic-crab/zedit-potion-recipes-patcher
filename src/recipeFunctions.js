//loading records into data structures.
function getLeveledItems() {
	let recs = GetRecords(baseFile, 'LVLI');
	let lists = {};
	lists.loot = {};
	lists.vendor = {};
	let lootNames = skillLevels.map(skill => 'Loot' + skill),
		vendorNames = skillLevels.map(skill => 'Vendor' + skill),
		lootItems = recs.filter(rec => lootNames.some(end => EditorID(rec).endsWith(end))),
		vendorItems = recs.filter(rec => vendorNames.some(end => EditorID(rec).endsWith(end)));
	lootItems.forEach(rec => {
		let edid = EditorID(rec),
			key = skillLevels.find(skill => edid.endsWith(skill)).toLowerCase();
		lists.loot[key] = copyToPatch(rec);
	});
	vendorItems.forEach(rec => {
		let edid = EditorID(rec),
			key = skillLevels.find(skill => edid.endsWith(skill)).toLowerCase();
		lists.vendor[key] = copyToPatch(rec);
	});
	return lists;
}
function getExcludedIngredients() {
	let exclusions = [];
	exclusions.unite(excludedIngredients);
	if(settings.excludeJarrinRoot) exclusions.push('Skyrim.esm/DBJarrinRoot');
	if(settings.excludeSaSItems) exclusions.unite([
		'Update.esm/ccBGS_RootRotScaleIngredient',
		'Update.esm/ccBGS_RootScreamingMawIngredient',
		'Update.esm/ccBGS_RootThornHookIngredient'
	]);
	return exclusions;
}
function ingredientRecToObject(rec) {
	let effects = GetElements(rec, 'Effects').map(effect => {
		let magicEffect = GetLinksTo(effect, 'EFID'),
			magnitude = GetValue(effect, 'EFIT\\Magnitude'),
			duration = GetValue(effect, 'EFIT\\Duration');
		return {effectID: GetFormID(magicEffect), magnitude, duration};
	});
	return {
		name: FullName(rec),
		handle: rec,
		uid: uniqueRecId(rec),
		effects,
		value: GetIntValue(rec, 'ENIT\\Ingredient Value')
	};
}
function effectIDtoObject(id) {
	let rec = GetRecord(0, id);
	rec = IsWinningOverride(rec)? rec: GetWinningOverride(rec);
	let poison = GetFlag(rec, 'Magic Effect Data\\DATA\\Flags', 'Detrimental') || GetFlag(rec, 'Magic Effect Data\\DATA\\Flags', 'Hostile') || HasKeyword(rec, 'MagicAlchHarmful');
	return {
		name: FullName(rec),
		formID: id,
		handle: rec,
		poison
	};
}

function getIngredientObjects() {
	debugMessage('Loading ingredient records');
	let ingredients = loadRecords('INGR', true)
		.filter(rec => IsWinningOverride(rec))
		.map(ingredientRecToObject)
		.filter(ing => !locals.excludedIngredients.includes(ing.uid));
	debugMessage(`Loaded ${ingredients.length} ingredients`);
	return Object.fromEntries(ingredients.map(ing => [ing.uid, ing]));
}
function getIngredientMagicEffects() {
	debugMessage('Loading magic effects from ingredients');
	let effects = Object.values(locals.ingredients)
		.map(obj => obj.effects.map(eff => eff.effectID))
		.reduce((netArray, thisArray) => netArray.concat(thisArray), [])
		.unique().sort()
		.map(effectIDtoObject);
	debugMessage(`Loaded ${effects.length} effects`);
	return Object.fromEntries(effects.map(eff => [eff.formID, eff]));
}

//functions to find all valid combinations of ingredients
function getIngredientsMatchingOneIngredient(firstIngredient, otherIngredients) {
	let firstIngredientEffectIDs = firstIngredient.effects.map(eff => eff.effectID);
	return otherIngredients.filter(ing => {
		let effectIDs = ing.effects.map(eff => eff.effectID);
		return effectIDs.some(id => firstIngredientEffectIDs.includes(id));
	});
}
function getIngredientsMatchingTwoIngredients(firstIngredient, secondIngredient, otherIngredients) {
	let firstIngredientEffectIDs = firstIngredient.effects.map(eff => eff.effectID);
	let secondIngredientEffectIDs = secondIngredient.effects.map(eff => eff.effectID);
	return otherIngredients.filter(ing => {
		let effectIDs = ing.effects.map(eff => eff.effectID);
		return effectIDs.some(id => firstIngredientEffectIDs.includes(id) 
								|| secondIngredientEffectIDs.includes(id));
	});
}
function isCombinationEquivalent(combination, otherCombination) {
	let effects = combination.effectIDs, otherEffects = otherCombination.effectIDs;
	return effects.every(eff => otherEffects.includes(eff)) && effects.length === otherEffects.length;
}
function checkAgainstSimpleCases(combination, simpleCases) {
	return simpleCases.every(simpleCase => !isCombinationEquivalent(combination, simpleCase));
}
function getCombination(ingredients) {
	let reagentIDs = ingredients.map(ingredient => ingredient.uid);
	let allEffects = {};
	ingredients.forEach(ingredient => {
		ingredient.effects.forEach(effect => {
			let id = effect.effectID;
			if(id in allEffects){
				allEffects[id] += 1;
			} else {
				allEffects[id] = 1;
			}
		});
	});
	let effectIDs = Object.keys(allEffects).filter(key => allEffects[key] > 1);
	return {reagentIDs, effectIDs};
}
function getAllCombinations(ingredients, effects) {
	let validCombinations = [];
	let ingredientKeys = Object.keys(ingredients).sort();
	debugMessage(`Finding valid combinations of ${ingredientKeys.length} ingredients with ${Object.keys(effects).length} different effects`);
	while (ingredientKeys.length > 0) {
		let firstIngredientKey = ingredientKeys.shift(),
			firstIngredient = ingredients[firstIngredientKey];
		let otherIngredients = ingredientKeys.map(key => ingredients[key]);
		let secondaryIngredients = getIngredientsMatchingOneIngredient(firstIngredient, otherIngredients);
		secondaryIngredients.forEach(secondIngredient => {
			let simpleCase = getCombination([firstIngredient, secondIngredient]);
			validCombinations.push(simpleCase);
			let secondIngredientIndex = ingredientKeys.findIndex(key => key === secondIngredient.uid);
			let otherOtherIngredients = ingredientKeys.slice(secondIngredientIndex + 1).map(key => ingredients[key]);
			let tertiaryIngredients = getIngredientsMatchingTwoIngredients(firstIngredient, secondIngredient, otherOtherIngredients);
			tertiaryIngredients.forEach(thirdIngredient => {
				let combination = getCombination([firstIngredient, secondIngredient, thirdIngredient]);
				let simpleCases = [simpleCase, 
									getCombination([firstIngredient, thirdIngredient]),
									getCombination([secondIngredient, thirdIngredient])
								];
				if(checkAgainstSimpleCases(combination, simpleCases)) validCombinations.push(combination);//exclude cases where third ingredient changes nothing
			});
		});
	}
	debugMessage(`Found ${validCombinations.length} combinations`);
	return validCombinations;
}

//functions to evaluate what a combination of ingredients actually makes,
//then get rid of garbage data.
function combinationToRecipe(combination) {
	let ingredients = combination.reagentIDs.map(id => locals.ingredients[id]);
	let effects = combination.effectIDs.map(id => locals.effects[id]);
	let potionEffects = effects.filter(eff => !eff.poison);
	let poisonEffects = effects.filter(eff => eff.poison);
	let type = potionEffects.length > poisonEffects.length? 'potion':'poison';
	let pure = potionEffects.length === 0 || poisonEffects.length === 0;
	return {ingredients, type, pure, potionEffects, poisonEffects};
}
function buildRecipeObject(combinations) {
	debugMessage('Building recipe data from detected combinations');
	let recipeObject = {potion: {pure: {}, impure: {}}, 
						poison: {pure: {}, impure: {}}};
	combinations.map(combinationToRecipe).forEach(recipe => {
		let list = recipeObject[recipe.type];
		list = recipe.pure? list.pure: list.impure;
		let effectsCount = recipe[recipe.type + 'Effects'].length;
		if(list[effectsCount] === undefined) list[effectsCount] = [];
		list[effectsCount].push(recipe);
	});
	return recipeObject;
}
function deleteImpureRecipesBelowThreshold(recipeObject, threshold) {
	debugMessage(`Deleting impure recipes with fewer than ${threshold} same type effects`);
	for(const type in recipeObject){
		let recipesByEffect = recipeObject[type].impure;
		for(let i = 0; i < threshold; i++) if(`${i}` in recipesByEffect) delete recipesByEffect[i];
	}
}
function getAllRecipes(recipeObject) {
	let recipes = [];
	Object.values(recipeObject).forEach(type =>
		Object.values(type).forEach(purity =>
			Object.values(purity).forEach(array => 
				recipes = recipes.concat(array))));
	return recipes;
}
function serializeRecipeObject(recipeObject) {
	debugMessage(`Beginning serialization`);
	let recipesJetpack = fh.userDir.cwd('recipes');
	Object.keys(recipeObject).forEach(potionType => {
		recipesJetpack.dir(potionType);
		let typeJetpack = recipesJetpack.cwd(potionType);
		Object.keys(recipeObject[potionType]).forEach(purity => {
			typeJetpack.dir(purity);
			let purityJetpack = typeJetpack.cwd(purity);
			Object.keys(recipeObject[potionType][purity]).forEach(count => {
				purityJetpack.dir(count);
				let countJetpack = purityJetpack.cwd(count);
				let recipes = recipeObject[potionType][purity][count];
				debugMessage(`Serializing ${recipes.count} ${purity} ${recipes} with ${count} effects`);
				recipes.forEach(recipe => {
					let filename = recipe.ingredients.map(ing => ing.name).sort().join().replace(/[\s'],/g, '') + '.json';
					countJetpack.write(filename, {
						ingredients: recipe.ingredients.map(ing => ing.uid),
						type: recipe.type,
						pure: recipe.pure,
						potionEffects: recipe.potionEffects.map(eff => `${eff.name} (${eff.formID.toString(16)})`),
						poisonEffects: recipe.poisonEffects.map(eff => eff.name)
					});
				});
			});
		});
	});
}

//functions to create records for a recipe
function writeNote(effectNames, ingredientNames, {type, pure}) {
	let name, fullText;
	if (effectNames.length === 1) {
		name = effectNames[0];
	} else if (effectNames.length === 2) {
		name = effectNames.join(' and ');
	} else {
		let index = effectNames.length - 1;
		let str = effectNames[index];
		effectNames[index] = 'and ' + str;
		name = effectNames.join(', ');
	}
	name = type === 'potion'? 'Potion of ' + name: name + ' Poison';
	if(!pure) name = 'Impure ' + name;
	let fontHeader = `<font face='$HandwrittenFont'>`,
		fontFooter = `</font>`,
		newLine = '\r\n',
		separator = newLine + newLine + '-';
	fullText = `${name}:${separator}` + ingredientNames.join(separator);
	fullText = fontHeader + newLine + fullText.trim() + newLine + fontFooter;
	name += ' Recipe';
	return {name, fullText};
}
function createRecipeNote(recipe, vanillaOverride = -1) {
	let effects = recipe[recipe.type + 'Effects'],
		effectHandles = effects.map(eff => eff.handle),
		effectNames = effects.map(eff => {
			let formID = eff.formID;
			let indices = recipe.ingredients.map(ing => ing.effects.findIndex(effID => effID === formID));
			let sumIndices = indices.reduce((a, b) => a + b, 0);
			return {name: eff.name, formID, sumIndices};
		}).sort((eff1, eff2) => {
			return eff1.sumIndices !== eff2.sumIndices?
				eff1.sumIndices - eff2.sumIndices:
				(eff1.name < eff2.name? -1: (eff1.name > eff2.name? 1: 0));
		}).map(eff => eff.name);
	let ingredients = recipe.ingredients.sort((a, b) => b.value - a.value),
		ingredientHandles = recipe.ingredients.map(ing => ing.handle),
		ingredientNames = recipe.ingredients.map(ing => ing.name);
	let newEDID = `Recipe${effectNames.map(name => name.replace(/[\s'-]/g, '')).join('')}`;
	if (newEDID in usedEdids) {
		usedEdids[newEDID] += 1;
	} else {
		usedEdids[newEDID] = 1;
	}
	newEDID += usedEdids[newEDID];
	let newRecipeNote = safeCopyAndCache(locals.templateRecipeNote, newEDID);
	SetValue(newRecipeNote, 'EDID', newEDID);
	let {name, fullText} = writeNote(effectNames, ingredientNames, recipe);
	SetValue(newRecipeNote, 'FULL', name);
	SetValue(newRecipeNote, 'DESC', fullText);
	for(let i = 5; i >= 0; i--){
		let effectPath = `VMAD\\Scripts\\[0]\\Properties\\[0]\\Value\\Array of Object\\[${i}]`;
		if(i >= effects.length) {
			RemoveElement(newRecipeNote, effectPath);
		} else {
			SetLinksTo(newRecipeNote, effectHandles[i], effectPath + `\\Object v2\\FormID`);
		}
	}
	for(let i = 2; i >= 0; i--){
		let ingredientPath = `VMAD\\Scripts\\[0]\\Properties\\[1]\\Value\\Array of Object\\[${i}]`;
		if(i >= ingredients.length) {
			RemoveElement(newRecipeNote, ingredientPath);
		} else {
			SetLinksTo(newRecipeNote, ingredientHandles[i], ingredientPath + `\\Object v2\\FormID`);
		}
	}
	if(vanillaOverride > 0) SetFormID(newRecipeNote, vanillaOverride);
	return newRecipeNote;
}

//leveled list functions
function getRecipeListName(recipe) {
	let {type, pure} = recipe,
		typeName = type.charAt(0).toUpperCase() + type.slice(1),
		purity = pure? 'Pure':'Impure',
		effects = recipe[type + 'Effects']
			.map(eff => eff.name.replace(/\s/g, ''))
			.sort().join('');
	return `${logName}_LItem${typeName + purity}` + effects;
}
function constructNewLeveledLists(recipeObject) {
	let getLeveledListCatName = (type, purity, count) => {//utility function to avoid breaking code when i inevitably decide the name format is bad.
		let typeName = type.charAt(0).toUpperCase() + type.slice(1),
			purityName = purity.charAt(0).toUpperCase() + purity.slice(1);
		return `${logName}_LItem${typeName + purityName + count}Effect`;
	}
	if(locals.leveledLists.groups === undefined) locals.leveledLists.groups = {};
	if(locals.leveledLists.byName === undefined) locals.leveledLists.byName = {};
	//build all categories first
	Object.keys(recipeObject).forEach(type => {
		let typeObject = recipeObject[type];
		Object.keys(typeObject).forEach(purity => {
			let purityObject = typeObject[purity];
			Object.keys(purityObject).forEach(count => {
				let name = getLeveledListCatName(type, purity, count);
				let newList = createNewLeveledItem(patchFile, name, ['foreach']);
				recursiveCache(newList, uniqueRecId(newList));
				SetValue(newList, 'EDID', name);//cache record be like "this is a good edid." it is not.
				locals.leveledLists.groups[name] = newList;
			});
		});
	});
	//build lists per effects
	Object.keys(recipeObject).forEach(type => {
		let typeObject = recipeObject[type];
		Object.keys(typeObject).forEach(purity => {
			let purityObject = typeObject[purity];
			Object.keys(purityObject).forEach(count => {
				let name = getLeveledListCatName(type, purity, count);
				let categoryList = locals.leveledLists.groups[name];
				let recipes = purityObject[count];
				recipes.forEach(recipe => {
					let recipeName = getRecipeListName(recipe);
					if(locals.leveledLists.byName[recipeName] === undefined){
						let recipeListHandle = createNewLeveledItem(patchFile, recipeName, ['forEach']);
						recursiveCache(recipeListHandle, uniqueRecId(recipeListHandle));
						SetValue(recipeListHandle, 'EDID', recipeName);
						AddLeveledEntry(categoryList, GetHexFormID(recipeListHandle), '1', '1');
						locals.leveledLists.byName[recipeName] = recipeListHandle;
					}
				});
			});
		});
	});
}
function assignNoteToRecipeList(note, recipe) {
	let listName = getRecipeListName(recipe),
		list = locals.leveledLists.byName[listName];
	AddLeveledEntry(list, GetHexFormID(note), '1', '1');
}

//get skill level
function getSkill(count, purity) {
	let impure = !purity;
	if(count == 1) {
		return 'novice';
	}
	if(count == 2) {
		if(impure) return 'novice';
		return 'apprentice';
	}
	if(count == 3) {
		if(impure) return 'adept';
		return 'expert';
	}
	if(count >= 4) {
		if(impure) return 'expert';
		return 'master';
	}
}
function patchRecsBySkill(record, helpers, settings, locals) {
	let edid = EditorID(record);
	let [match, purity, count] = recipeRegex.exec(edid);
	let skill = getSkill(parseInt(count), purity === 'Pure');
	debugMessage(`Assigning ${edid} as a ${skill} recipe`);
	let lootList = locals.leveledLists.loot[skill],
		vendorList = locals.leveledLists.vendor[skill];
	AddLeveledEntry(lootList, GetHexFormID(record), '1', '1');
	AddLeveledEntry(vendorList, GetHexFormID(record), '1', '1');
}
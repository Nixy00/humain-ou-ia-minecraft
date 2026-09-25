const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const { Vec3 } = require('vec3');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const logBot = (msg) => console.log(`\x1b[36m[Cerveau Bot]\x1b[0m ${msg}`);
const logAction = (msg) => console.log(`\x1b[33m[Action]\x1b[0m ${msg}`);
const logAlert = (msg) => console.log(`\x1b[31m[Alerte]\x1b[0m ${msg}`);

function createMyBot() {
  const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'AssistantBot',
    version: '1.20.4'
  });

  let modeGarde = false;
  let maitre = null;
  let mcData;
  let isDancing = false;

  bot._client.prependListener('entity_velocity', (packet) => {
    if (bot.entity && packet.entityId === bot.entity.id) {
      packet.velocityX = 0; packet.velocityY = 0; packet.velocityZ = 0;
    }
  });
  
  bot._client.prependListener('explosion', (packet) => {
    packet.playerMotionX = 0; packet.playerMotionY = 0; packet.playerMotionZ = 0;
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    logBot(`${bot.username} est en ligne. L'IA est chargée.`);
    mcData = minecraftData(bot.version);
    const defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = false; 
    bot.pathfinder.setMovements(defaultMove);

    setInterval(autoEat, 10000);
    setInterval(scanMenaces, 1000);
  });

  bot.on('playerCollect', async (collector, itemDrop) => {
    if (collector === bot.entity) {
      setTimeout(async () => {
        const items = bot.inventory.items();
        for (const item of items) {
          try {
            if (item.name.includes('helmet')) await bot.equip(item, 'head');
            if (item.name.includes('chestplate')) await bot.equip(item, 'torso');
            if (item.name.includes('leggings')) await bot.equip(item, 'legs');
            if (item.name.includes('boots')) await bot.equip(item, 'feet');
            if (item.name.includes('shield')) await bot.equip(item, 'off-hand');
          } catch (err) { }
        }
      }, 500);
    }
  });

  async function autoEat() {
    if (bot.food < 16) {
      const foods = bot.inventory.items().filter(item => 
        item.name.includes('apple') || item.name.includes('bread') || 
        item.name.includes('cooked') || item.name.includes('beef') || 
        item.name.includes('porkchop')
      );
      if (foods.length > 0) {
        try {
          await bot.equip(foods[0], 'hand');
          await bot.consume();
        } catch (err) { }
      }
    }
  }

  function scanMenaces() {
    if (!modeGarde || !maitre) return;
    const maitreEntity = bot.players[maitre]?.entity;
    if (!maitreEntity) return;

    const monstresHostiles = ['zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman'];
    const menace = Object.values(bot.entities).find(entity => {
      return monstresHostiles.includes(entity.name) && entity.position.distanceTo(maitreEntity.position) < 6;
    });

    if (menace) {
      bot.chat(`Je te protège ! Sus au ${menace.name} !`);
      attaquer(menace);
    } else if (bot.entity.position.distanceTo(maitreEntity.position) > 4 && !bot.pathfinder.isMoving()) {
      bot.pathfinder.setGoal(new goals.GoalFollow(maitreEntity, 2), true);
    }
  }

  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) {
      const agresseur = Object.values(bot.entities).find(e => e.position.distanceTo(bot.entity.position) < 4 && e !== bot.entity);
      if (agresseur) attaquer(agresseur);
    }
  });

  async function attaquer(cible) {
    bot.pathfinder.setGoal(new goals.GoalFollow(cible, 1), true);
    
    const weapons = bot.inventory.items().filter(item => item.name.includes('sword') || item.name.includes('axe'));
    if (weapons.length > 0) await bot.equip(weapons[0], 'hand');

    if (bot.combatInterval) clearInterval(bot.combatInterval);
    bot.combatInterval = setInterval(() => {
      if (!cible || !cible.isValid) {
        clearInterval(bot.combatInterval);
        bot.pathfinder.setGoal(null);
        return;
      }
      if (bot.entity.position.distanceTo(cible.position) < 3.5) {
        bot.lookAt(cible.position.offset(0, cible.height, 0));
        
        bot.setControlState('jump', true);
        bot.attack(cible);
        setTimeout(() => bot.setControlState('jump', false), 200);
      }
    }, 600);
  }

  async function cerveauBot(username, message) {
    const msg = message.toLowerCase();
    logBot(`Ordre : "${message}"`);

    if (msg.includes('arrête') || msg.includes('stop')) {
      if (bot.combatInterval) clearInterval(bot.combatInterval);
      modeGarde = false;
      isDancing = false;
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      return bot.chat("OK, j'arrête tout.");
    }

    if (msg.includes('danse')) {
      isDancing = true;
      bot.chat("C'est parti pour la fête !");
      const danceInterval = setInterval(() => {
        if (!isDancing) { clearInterval(danceInterval); return; }
        bot.setControlState('sneak', !bot.controlState.sneak);
      }, 150);
      return;
    }

    if (msg.includes('bois') || msg.includes('bûcheron')) {
      bot.chat("Je pars couper du bois !");
      const logIds = mcData.blocksArray.filter(b => b.name.includes('log')).map(b => b.id);
      
      const arbre = bot.findBlock({ matching: logIds, maxDistance: 40 });
      if (!arbre) return bot.chat("Je ne vois aucun arbre autour de moi...");

      try {
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(arbre.position, bot.world));
        
        const haches = bot.inventory.items().filter(item => item.name.includes('axe') && !item.name.includes('pickaxe'));
        if (haches.length > 0) await bot.equip(haches[0], 'hand');

        await bot.dig(arbre);
        bot.chat("Arbre abattu ! Je ramasse le bois.");
        await bot.pathfinder.goto(new goals.GoalBlock(arbre.position.x, arbre.position.y, arbre.position.z));
      } catch (err) {
        bot.chat("Oups, je n'ai pas pu atteindre l'arbre.");
      }
      return;
    }

    if (msg.includes('protège') || msg.includes('garde')) {
      maitre = username === 'AdminTerminal' ? 'AdminTerminal' : username;
      modeGarde = true;
      return bot.chat("Mode Garde du corps activé. Je te couvre !");
    }

    if (msg.includes('attaque') || msg.includes('tue')) {
      const words = message.split(' ');
      const targetName = words[words.findIndex(w => w === 'attaque' || w === 'tue') + 1];
      if (!targetName) return bot.chat("Qui ?");
      const targetPlayer = bot.players[targetName]?.entity;
      if (!targetPlayer) return bot.chat(`Introuvable.`);
      
      bot.chat(`Cible acquise : ${targetName}. J'y vais !`);
      attaquer(targetPlayer);
      return;
    }
  }

  bot.on('chat', (username, message) => { if (username !== bot.username) cerveauBot(username, message); });
  rl.removeAllListeners('line');
  rl.on('line', (input) => cerveauBot('AdminTerminal', input));

  bot.on('death', () => bot.respawn());
  bot.on('kicked', (reason) => console.log('[Bot Kicked]', reason));
  bot.on('end', () => setTimeout(createMyBot, 5000));
}

createMyBot();
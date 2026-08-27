// Mirror of the `id` values in public/audio/sound-library.js SOUND_LIST.
// The server never synthesizes or analyzes audio (that stays entirely
// client-side, unchanged) - it only needs these ids to deal a shared,
// no-repeat sound to each turn across a room. Keep this list in sync with
// the client library if sounds are added or removed there.

const SOUND_IDS = [
  'boing',
  'burp', 'sneeze', 'fart', 'babycry', 'evillaugh', 'whistle', 'doorcreak',
  'carhorn', 'siren', 'phonering', 'robotbeep', 'laser', 'monsterroar', 'kazoo',
  // Real animal recordings (see public/audio/sound-library.js + samples/CREDITS.md)
  'chicken_1', 'chicken_2', 'chicken_3', 'chicken_4', 'chicken_5',
  'rooster_1',
  'pig_1', 'pig_2', 'pig_3',
  'horse_1', 'horse_2', 'horse_3',
  'dog_1', 'dog_2',
  'dog_small_1', 'dog_small_2',
  'dog_big_1', 'dog_big_2',
  'dog_howl_1',
  'cat_1', 'cat_2', 'cat_3', 'cat_4',
  'cow_1',
  'sheep_1', 'sheep_2',
  'goat_1', 'goat_2',
  'duck_1',
  'turkey_1', 'turkey_2',
  'monkey_1', 'monkey_2', 'monkey_3',
  'donkey_1',
  'frog_1', 'frog_2',
  'bird_1', 'bird_2',
  'owl_1',
  'goose_1',
  'lion_1',
  'chimp_1',
  'elephant_1',
  'bear_1',
  'wolf_1',
];

module.exports = { SOUND_IDS };

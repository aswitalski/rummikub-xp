const League = require('../server/services/league.js');

describe('League', () => {

  describe('=> calculate points', () => {

    it('supports no draws scenario', () => {

      // given
      const players = [
        {
          name: 'A',
          score: 10,
        },
        {
          name: 'B',
          score: -20,
        },
        {
          name: 'C',
          score: 40,
        },
        {
          name: 'D',
          score: -30,
        }
      ];

      // when
      const result = League.calculate(players);

      // then
      assert.deepEqual(result, [
        {
          place: 1,
          name: 'C',
          score: 40,
          points: 5,
        },
        {
          place: 2,
          name: 'A',
          score: 10,
          points: 3,
        },
        {
          place: 3,
          name: 'B',
          score: -20,
          points: 1,
        },
        {
          place: 4,
          name: 'D',
          score: -30,
          points: 0,
        },
      ]);
    });

    it('supports draw between two players', () => {

      // given
      const players = [
        {
          name: 'A',
          score: 19,
        },
        {
          name: 'B',
          score: 5,
        },
        {
          name: 'C',
          score: 19,
        },
        {
          name: 'D',
          score: -44,
        }
      ];

      // when
      const result = League.calculate(players);

      // then
      assert.deepEqual(result, [
        {
          place: 1,
          name: 'A',
          score: 19,
          points: 5,
        },
        {
          place: 1,
          name: 'C',
          score: 19,
          points: 5,
        },
        {
          place: 3,
          name: 'B',
          score: 5,
          points: 1,
        },
        {
          place: 4,
          name: 'D',
          score: -44,
          points: 0,
        },
      ]);
    });

    it('supports draw between three players', () => {

      // given
      const players = [
        {
          name: 'A',
          score: -10,
        },
        {
          name: 'B',
          score: -10,
        },
        {
          name: 'C',
          score: 30,
        },
        {
          name: 'D',
          score: -10,
        }
      ];

      // when
      const result = League.calculate(players);

      // then
      assert.deepEqual(result, [
        {
          place: 1,
          name: 'C',
          score: 30,
          points: 5,
        },
        {
          place: 2,
          name: 'A',
          score: -10,
          points: 3,
        },
        {
          place: 2,
          name: 'B',
          score: -10,
          points: 3,
        },
        {
          place: 2,
          name: 'D',
          score: -10,
          points: 3,
        },
      ]);
    });

    it('supports multiple draws', () => {

      // given
      const players = [
        {
          name: 'A',
          score: 5,
        },
        {
          name: 'B',
          score: -5,
        },
        {
          name: 'C',
          score: 5,
        },
        {
          name: 'D',
          score: -5,
        }
      ];

      // when
      const result = League.calculate(players);

      // then
      assert.deepEqual(result, [
        {
          place: 1,
          name: 'A',
          score: 5,
          points: 5,
        },
        {
          place: 1,
          name: 'C',
          score: 5,
          points: 5,
        },
        {
          place: 3,
          name: 'B',
          score: -5,
          points: 1,
        },
        {
          place: 3,
          name: 'D',
          score: -5,
          points: 1,
        },
      ]);
    });
  });
});

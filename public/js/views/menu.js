export default class Menu extends opr.Toolkit.Component {

  render() {
    return [
      'main',
      [
        'button',
        'Continue game',
      ],
      [
        'button',
        'New game',
      ],
      [
        'button',
        'Statistics',
      ],
      [
        'button',
        'Settings',
      ],
    ];
  }
}
export default class Login extends opr.Toolkit.Component {

  render() {
    return [
      'form',
      [
        'input',
        {
          type: 'text',
        },
      ],
      [
        'input',
        {
          type: 'password',
        },
      ],
    ];
  }
}
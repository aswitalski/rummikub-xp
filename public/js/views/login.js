import API from '../services/api.js';

export default class Login extends opr.Toolkit.Component {

  async onSubmit(event) {
    event.preventDefault();
    const username = this.ref.querySelector('#username').value;
    const password = this.ref.querySelector('#password').value;
    const payload = await API.signIn(username, password);
    if (payload && payload.token) {
      sessionStorage.setItem('token', payload.token);
      this.commands.update({
        view: null,
      });
    }
  }

  render() {
    return [
      'main',
      [
        'form',
        {
          onSubmit: this.onSubmit,
        },
        [
          'input',
          {
            id: 'username',
            type: 'text',
            placeholder: 'Name',
          },
        ],
        [
          'input',
          {
            id: 'password',
            type: 'password',
            placeholder: 'Password',
          },
        ],
        [
          'button',
          'Sign in',
        ],
      ],
    ];
  }
}

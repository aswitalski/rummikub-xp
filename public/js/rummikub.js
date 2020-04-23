import Error from './views/error.js';
import Login from './views/login.js';
import Menu from './views/menu.js';

import API from './services/api.js';

export default class Rummikub extends opr.Toolkit.WebComponent {

  async getInitialState() {
    try {
      const data = await API.health();
      if (data === null) {
        return {
          view: 'login',
        };
      }
      return {
        data,
      };
    } catch (e) {
      return {
        view: 'error',
        message: e.message,
      };
    }
  }

  render() {
    switch (this.props.view) {
      case 'login':
        return [
          Login,
          this.props,
        ];
      case 'error':
        return [
          Error,
          this.props,
        ];
      default:
        return [
          Menu,
          this.props,
        ];
    }
  }
}

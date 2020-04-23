export default class Error extends opr.Toolkit.Component {

  render() {
    return [
      'section',
      {
        class: 'error',
      },
      this.props.message,
    ];
  }
}
export default class Error extends opr.Toolkit.Component {

  render() {
    return [
      'main',
      [
        'section',
        {
          class: 'error',
        },
        this.props.message,
      ],
      [
        'button',
        'Try again',
      ],
    ];
  }
}

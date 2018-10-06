import ssh2 from 'ssh2'
import Tunnelist from './tunnelist'

describe('Tunnelist', () => {
  it('should create an ssh server', () => {
    let tunnel = new Tunnelist()
    expect(tunnel.server instanceof ssh2.Server).toBeTruthy()
  })
})
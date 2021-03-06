import type from 'type-of-is';

import Route from './Route';
import MatchResult from './MatchResult';

export default class Router {
  constructor ({
    routes,
    redirects,
    max_redirects = 10
  }) {
    this.routes = [];
    this.addRoutes(routes);
    this.max_redirects = max_redirects;

    this.redirects = [];
    for (const [name, test] of Object.entries(redirects)) {
      this.redirects.push({name, test});
    }

    this.listeners = [];
  }

  addRoutes (routes) {
    const entries = Object.entries(routes);
    for (const [name, config] of entries) {
      config.name = name;
      const route = new Route(config);
      this.routes.push(route);
    }
  }

  getRoute (query) {
    return this.routes.find((route)=> {
      return Object.entries(query).every(([k, v])=> {
        return (route[k] === v);
      });
    });
  }

  getRouteByName (name) {
    const route = this.getRoute({name});
    if (!route) {
      throw new Error(`No route named ${name}`);
    }
    return route;
  }

  // match
  // -----
  // Checks whether there is a route matching the passed pathname
  // If there is a match, returns the associated Page and matched params.
  // If no match return NotFound
  match (input) {
    const original = this._match(input);
    const redirect = this._checkRedirects({original});
    if (redirect) {
      redirect.isRedirect({original});
      return redirect;
    } else {
      return original;
    }
  }

  _match (input) {
    input = (()=> {
      switch (type(input)) {
        case String:
          if (input.indexOf('/') !== -1) {
            return {url: input};
          } else {
            return {route: {name: input}};
          }
        case Object:
          if (input.name) {
            return {route: input};
          } else {
            return input;
          }
        default:
          throw new Error('Invalid input passed to _match');
      }
    })();

    // if passed full url, treat as redirect
    const {url} = input;
    if (url && url.match(/^https?:\/\//)) {
      return new MatchResult({
        redirect: true,
        input,
        url
      });
    }

    let match = null;
    for (const r of this.routes) {
      match = r.match(input);
      if (match) {
        break;
      }
    }

    return match;
  }

  _checkRedirects ({
    original,
    previous = null,
    current = null,
    num_redirects = 0,
    history = []
  }) {
    const {max_redirects} = this;
    if (num_redirects >= max_redirects) {
      throw new Error(`Number of redirects exceeded max_redirects (${max_redirects})`);
    }

    function deepEqual (a, b) {
      const {stringify} = JSON;
      return (stringify(a) === stringify(b));
    }

    // if current is the same as original, then we've looped, so this shouldn't
    // be a redirect
    // TODO: improve cycle detection
    if (current && previous) {
      const same_route = (current.route === previous.route);
      const same_params = deepEqual(current.params, previous.params);
      if (same_route && same_params) {
        return previous;
      }
    }

    if (!current) {
      current = original;
      history = [original];
    }

    if (current.redirect) {
      return current;
    }

    let next = false;
    if (current && current.route.redirect) {
      next = current.route.redirect(current);
    }
    if (!next) {
      for (const {test} of this.redirects) {
        // test returns false if no redirect is needed
        next = test(current);
        if (next) {
          break;
        }
      }
    }

    if (next) {
      previous = current;
      // we got a redirect
      current = this._match(next);
      if (!current) {
        throw new Error(`No match for redirect result ${next}`);
      }
      history.push(current);
      num_redirects++;
      return this._checkRedirects({original, previous, current, num_redirects, history});
    } else if (num_redirects > 0) {
      return current;
    } else {
      return false;
    }
  }

  onChange (listener) {
    this.listeners.push(listener);
  }

  go (input) {
    const match = this.match(input);
    const {url} = match;
    for (const listener of this.listeners) {
      listener(url);
    }
  }
}

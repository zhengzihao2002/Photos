package photos.utility;
import java.io.Serializable;
import java.util.ArrayList;

/**
 * A class representing a user in the photo management system.
 *
 * The User class contains information about the user, including their username,
 * password, and account type. It also contains a list of albums associated with
 * the user.
 *
 * @since 2023-04-13
 * @author
 *      Zihao Zheng, Yiming Huang
 *
 * @version 1.0
 */

public class User implements Serializable {
    private static final long serialVersionUID = 1L;
    
    /**
     * The user name of the current user
    */
	private String username;
	
	/**
     * The password of the current user
    */
    private String password;
    
    /**
     * The type of the current user, could be Administrator or Non-admin
    */
    private String type; 
    
    /**
     * The Arraylist of albums the user has
    */
    public ArrayList<Album> albums=null;
    
    /**
     * Sets the username, password and type for the current user.
     * @param username : The username of the user
     * @param password :  The password of the user
     * @param type : The type of the user, Non-admin or Administrator
    */
    public User(String username, String password, String type) {
        this.username = username; 
        this.password = password;
        this.type = type;
    }
    
    /**
     * This method gets the user name of the current user
     * @return username of user
     */
    public String getUsername() {
        return username;
    }
    /**
     * This method gets the password of the current user
     * @return password of user
     */
    public String getPassword() {
        return password;
    }

    /**
     * This method gets the type of the current user
     * @return type of user
     */
    public String getType() {
        return type;
    }


}
